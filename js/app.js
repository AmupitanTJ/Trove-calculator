/**
 * TROVE Calculator
 * Standard + Scientific calculator with history, memory, themes, and a11y.
 */
const Calculator = (() => {
  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const STORAGE = {
    mode: "calculatorMode",
    theme: "calculatorTheme",
    history: "calculatorHistory",
    welcome: "troveCalcWelcomeSeen",
  };

  const HISTORY_LIMIT = 50;
  const EXPRESSION_MAX = 200;
  const SPLASH_MS = 800;
  const REDUCED_MOTION = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  const getSystemTheme = () =>
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";

  const loadHistory = () => {
    try {
      const raw = localStorage.getItem(STORAGE.history);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item) =>
            item &&
            typeof item.expression === "string" &&
            typeof item.result === "number" &&
            Number.isFinite(item.result) &&
            typeof item.timestamp === "number"
        )
        .slice(0, HISTORY_LIMIT);
    } catch {
      return [];
    }
  };

  const resolveStoredTheme = () => {
    const stored = localStorage.getItem(STORAGE.theme);
    if (stored === "dark" || stored === "light") return stored;
    return getSystemTheme();
  };

  // ---------------------------------------------------------------------------
  // State & DOM cache
  // ---------------------------------------------------------------------------

  const state = {
    expression: "",
    /** Last committed result (shown until next Equals / Clear) */
    displayResult: "0",
    isScientific: localStorage.getItem(STORAGE.mode) === "scientific",
    theme: resolveStoredTheme(),
    history: loadHistory(),
    historyOpen: false,
    aboutOpen: false,
    welcomeOpen: false,
    selectedHistoryIndex: null,
    memory: null,
  };

  const DOM = {};
  const motionTimers = new WeakMap();
  let announceTimer = null;
  let copyResetTimer = null;
  let historyCloseTimer = null;

  // ---------------------------------------------------------------------------
  // Screen reader
  // ---------------------------------------------------------------------------

  const announce = (message) => {
    if (!DOM.srAnnouncer || !message) return;
    DOM.srAnnouncer.textContent = "";
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      DOM.srAnnouncer.textContent = message;
    }, 40);
  };

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  const formatNumber = (num) => {
    if (typeof num !== "number" || !Number.isFinite(num)) return "0";
    if (num !== 0 && (Math.abs(num) < 1e-4 || Math.abs(num) >= 1e12)) {
      return num.toExponential(6);
    }
    return num.toLocaleString("en-US", {
      maximumFractionDigits: 10,
      minimumFractionDigits: 0,
    });
  };

  const formatHistoryExpression = (expr) =>
    String(expr).replace(/\*/g, "×").replace(/\//g, "÷");

  // ---------------------------------------------------------------------------
  // Expression engine (safe recursive-descent parser)
  // ---------------------------------------------------------------------------

  const scientificFunctions = {
    sin: (x) => Math.sin((x * Math.PI) / 180),
    cos: (x) => Math.cos((x * Math.PI) / 180),
    tan: (x) => Math.tan((x * Math.PI) / 180),
    asin: (x) => {
      if (x < -1 || x > 1) throw new Error("asin domain");
      return (Math.asin(x) * 180) / Math.PI;
    },
    acos: (x) => {
      if (x < -1 || x > 1) throw new Error("acos domain");
      return (Math.acos(x) * 180) / Math.PI;
    },
    atan: (x) => (Math.atan(x) * 180) / Math.PI,
    sqrt: (x) => {
      if (x < 0) throw new Error("sqrt domain");
      return Math.sqrt(x);
    },
    ln: (x) => {
      if (x <= 0) throw new Error("ln domain");
      return Math.log(x);
    },
    log: (x) => {
      if (x <= 0) throw new Error("log domain");
      return Math.log10(x);
    },
    exp: (x) => Math.exp(x),
    abs: (x) => Math.abs(x),
    factorial: (x) => {
      if (x < 0 || !Number.isInteger(x)) throw new Error("factorial domain");
      if (x > 170) throw new Error("factorial overflow");
      let result = 1;
      for (let i = 2; i <= x; i++) result *= i;
      return result;
    },
  };

  const constants = { pi: Math.PI, e: Math.E };

  const flushBuffer = (buffer, tokens) => {
    if (!buffer) return "";
    const lower = buffer.toLowerCase();
    if (scientificFunctions[lower]) {
      tokens.push({ type: "function", value: lower });
    } else if (constants[lower] !== undefined) {
      tokens.push({ type: "number", value: constants[lower] });
    } else if (buffer.trim() !== "" && !Number.isNaN(Number(buffer))) {
      tokens.push({ type: "number", value: parseFloat(buffer) });
    } else {
      throw new Error(`Unknown token: ${buffer}`);
    }
    return "";
  };

  const tokenize = (expression) => {
    const tokens = [];
    let current = "";

    for (let i = 0; i < expression.length; i++) {
      const char = expression[i];

      if (char === "π") {
        current = flushBuffer(current, tokens);
        tokens.push({ type: "number", value: Math.PI });
        continue;
      }

      if (/[a-zA-Z]/.test(char)) {
        if (current && !Number.isNaN(Number(current)) && current.trim() !== "") {
          current = flushBuffer(current, tokens);
          tokens.push({ type: "operator", value: "*" });
        }
        current += char;
      } else if (/\d/.test(char) || char === ".") {
        if (current && /[a-zA-Z]/.test(current.at(-1))) {
          current = flushBuffer(current, tokens);
          const prev = tokens.at(-1);
          if (prev && (prev.type === "number" || prev.value === ")")) {
            tokens.push({ type: "operator", value: "*" });
          }
        }
        // Prevent multiple decimals in one number fragment
        if (char === "." && current.includes(".")) {
          throw new Error("Invalid number");
        }
        current += char;
      } else if ("+-*/%^()".includes(char)) {
        if (char === "(" && current) {
          const lower = current.toLowerCase();
          if (scientificFunctions[lower]) {
            tokens.push({ type: "function", value: lower });
            current = "";
          } else {
            current = flushBuffer(current, tokens);
            tokens.push({ type: "operator", value: "*" });
          }
        } else if (char === "(") {
          const prev = tokens.at(-1);
          if (prev && (prev.type === "number" || prev.value === ")")) {
            tokens.push({ type: "operator", value: "*" });
          }
          current = flushBuffer(current, tokens);
        } else {
          current = flushBuffer(current, tokens);
        }

        if (char === "-") {
          const prev = tokens.at(-1);
          const isUnary =
            !prev || (prev.type === "operator" && prev.value !== ")");
          if (isUnary) tokens.push({ type: "number", value: 0 });
        }

        tokens.push({ type: "operator", value: char });
      } else if (char === " ") {
        current = flushBuffer(current, tokens);
      } else if (char === "!") {
        current = flushBuffer(current, tokens);
        tokens.push({ type: "operator", value: "!" });
      } else {
        throw new Error(`Invalid character: ${char}`);
      }
    }

    flushBuffer(current, tokens);
    return tokens;
  };

  const validateTokens = (tokens) => {
    if (tokens.length === 0) throw new Error("Empty expression");

    let parenCount = 0;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.value === "(") {
        parenCount++;
        if (tokens[i + 1]?.value === ")") throw new Error("Empty parentheses");
      } else if (token.value === ")") {
        parenCount--;
        if (parenCount < 0) throw new Error("Mismatched parentheses");
      }
    }
    if (parenCount !== 0) throw new Error("Mismatched parentheses");

    const last = tokens.at(-1);
    if (
      last.type === "operator" &&
      last.value !== ")" &&
      last.value !== "!"
    ) {
      throw new Error("Trailing operator");
    }
  };

  class ExpressionParser {
    constructor(tokens) {
      this.tokens = tokens;
      this.pos = 0;
    }

    parse() {
      const result = this.parseExpression();
      if (this.pos < this.tokens.length) throw new Error("Unexpected token");
      return result;
    }

    parseExpression() {
      return this.parseAddSub();
    }

    parseAddSub() {
      let result = this.parseMulDiv();
      while (
        this.pos < this.tokens.length &&
        (this.tokens[this.pos].value === "+" ||
          this.tokens[this.pos].value === "-")
      ) {
        const op = this.tokens[this.pos].value;
        this.pos++;
        const right = this.parseMulDiv();
        result = op === "+" ? result + right : result - right;
      }
      return result;
    }

    parseMulDiv() {
      let result = this.parsePower();
      while (
        this.pos < this.tokens.length &&
        "*/%".includes(this.tokens[this.pos].value)
      ) {
        const op = this.tokens[this.pos].value;
        this.pos++;
        const right = this.parsePower();
        if (op === "*") result *= right;
        else if (op === "/") {
          if (right === 0) throw new Error("Division by zero");
          result /= right;
        } else {
          if (right === 0) throw new Error("Modulo by zero");
          result %= right;
        }
      }
      return result;
    }

    parsePower() {
      let result = this.parseUnary();
      if (this.pos < this.tokens.length && this.tokens[this.pos].value === "^") {
        this.pos++;
        const right = this.parsePower(); // right-associative
        result = Math.pow(result, right);
      }
      while (
        this.pos < this.tokens.length &&
        this.tokens[this.pos].value === "!"
      ) {
        this.pos++;
        result = scientificFunctions.factorial(result);
      }
      return result;
    }

    parseUnary() {
      if (this.tokens[this.pos]?.type === "function") {
        const func = this.tokens[this.pos].value;
        this.pos++;
        return scientificFunctions[func](this.parsePrimary());
      }
      return this.parsePrimary();
    }

    applyFactorial(value) {
      while (
        this.pos < this.tokens.length &&
        this.tokens[this.pos].value === "!"
      ) {
        this.pos++;
        value = scientificFunctions.factorial(value);
      }
      return value;
    }

    parsePrimary() {
      const token = this.tokens[this.pos];
      if (!token) throw new Error("Unexpected end");

      if (token.value === "(") {
        this.pos++;
        const result = this.parseExpression();
        if (this.tokens[this.pos]?.value !== ")") {
          throw new Error("Mismatched parentheses");
        }
        this.pos++;
        return this.applyFactorial(result);
      }

      if (token.type === "number") {
        this.pos++;
        return this.applyFactorial(token.value);
      }

      throw new Error("Expected number or parenthesis");
    }
  }

  const evaluateExpression = (expression) => {
    const tokens = tokenize(expression);
    validateTokens(tokens);
    const result = new ExpressionParser(tokens).parse();
    if (!Number.isFinite(result)) throw new Error("Invalid result");
    return result;
  };

  // ---------------------------------------------------------------------------
  // Display
  // ---------------------------------------------------------------------------

  const playMotion = (element, className, durationMs = 400) => {
    if (!element || REDUCED_MOTION()) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    const prev = motionTimers.get(element);
    if (prev) window.clearTimeout(prev);
    const id = window.setTimeout(() => {
      element.classList.remove(className);
      motionTimers.delete(element);
    }, durationMs);
    motionTimers.set(element, id);
  };

  const animateCommittedResult = () => {
    playMotion(DOM.resultDisplay, "is-updating", 400);
    playMotion(DOM.expressionDisplay, "is-updating", 300);
  };

  /**
   * Update expression line only while typing.
   * Result line updates only after Equals (or Clear / Error / MR / history).
   */
  const updateDisplay = () => {
    DOM.expressionDisplay.textContent = state.expression || "0";
    DOM.resultDisplay.textContent = state.displayResult;
  };

  const setDisplayResult = (value) => {
    state.displayResult =
      typeof value === "number" ? formatNumber(value) : String(value);
    DOM.resultDisplay.textContent = state.displayResult;
  };

  const endsWithValue = (expr) => {
    if (!expr) return false;
    return /[0-9)πe.]$/i.test(expr) || /(?:pi|e)$/i.test(expr);
  };

  const clearErrorIfNeeded = () => {
    if (DOM.expressionDisplay.textContent === "Error!") {
      state.expression = "";
      setDisplayResult("0");
      updateDisplay();
    }
  };

  const appendToExpression = (value) => {
    clearErrorIfNeeded();
    if (state.expression.length + String(value).length > EXPRESSION_MAX) {
      announce("Expression too long");
      return;
    }
    // Guard double decimal in current number fragment
    if (value === ".") {
      const parts = state.expression.split(/[+\-*/%^()]/);
      const last = parts.at(-1) || "";
      if (last.includes(".")) return;
      if (!last || /[+\-*/%^]$/.test(state.expression)) {
        state.expression += "0.";
        updateDisplay();
        return;
      }
    }
    state.expression += value;
    updateDisplay();
  };

  const clearExpression = () => {
    state.expression = "";
    setDisplayResult("0");
    updateDisplay();
  };

  const clearExpressionWithAnnounce = () => {
    clearExpression();
    announce("Display cleared");
  };

  // ---------------------------------------------------------------------------
  // Scientific input helpers
  // ---------------------------------------------------------------------------

  const handleScientificFunction = (name) => {
    clearErrorIfNeeded();

    if (name === "pi") {
      appendToExpression(endsWithValue(state.expression) ? "*π" : "π");
      return;
    }
    if (name === "e") {
      appendToExpression(endsWithValue(state.expression) ? "*e" : "e");
      return;
    }
    if (name === "square") {
      appendToExpression("^2");
      return;
    }
    if (name === "cube") {
      appendToExpression("^3");
      return;
    }
    if (name === "power") {
      appendToExpression("^");
      return;
    }
    if (name === "factorial") {
      appendToExpression(endsWithValue(state.expression) ? "!" : "factorial(");
      return;
    }

    // Unary functions: wrap complete expression when possible
    if (endsWithValue(state.expression)) {
      try {
        evaluateExpression(state.expression);
        state.expression = `${name}(${state.expression})`;
        updateDisplay();
        return;
      } catch {
        /* fall through */
      }
    }
    appendToExpression(`${name}(`);
  };

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  const persistHistory = () => {
    try {
      localStorage.setItem(STORAGE.history, JSON.stringify(state.history));
    } catch {
      /* private mode / quota */
    }
  };

  const startOfDay = (ts) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  const getDateGroupLabel = (timestamp) => {
    const day = startOfDay(timestamp);
    const today = startOfDay(Date.now());
    if (day === today) return "Today";
    if (day === today - 86400000) return "Yesterday";
    return new Date(timestamp).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year:
        new Date(timestamp).getFullYear() === new Date().getFullYear()
          ? undefined
          : "numeric",
    });
  };

  const formatAbsoluteTime = (timestamp) =>
    new Date(timestamp).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });

  const formatRelativeTime = (timestamp) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 45) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  const groupHistoryByDate = (items) => {
    const groups = [];
    const map = new Map();
    items.forEach((entry, index) => {
      const label = getDateGroupLabel(entry.timestamp);
      if (!map.has(label)) {
        const group = { label, items: [] };
        map.set(label, group);
        groups.push(group);
      }
      map.get(label).items.push({ entry, index });
    });
    return groups;
  };

  const scrollToNewestHistory = (behavior = "smooth") => {
    if (!DOM.historyList) return;
    const newest = DOM.historyList.querySelector(".history-item--newest");
    if (newest) newest.scrollIntoView({ behavior, block: "nearest" });
    else DOM.historyList.scrollTop = 0;
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const renderHistory = (options = {}) => {
    if (!DOM.historyList) return;
    const { scrollToNewest = false, instantScroll = false } = options;
    const items = state.history;

    DOM.historyCount.textContent = String(items.length);
    DOM.historyCount.setAttribute(
      "aria-label",
      `${items.length} ${items.length === 1 ? "item" : "items"}`
    );
    DOM.historyClear.disabled = items.length === 0;
    if (DOM.historyHint) DOM.historyHint.hidden = items.length === 0;

    DOM.historyList.replaceChildren();

    if (items.length === 0) {
      DOM.historyEmpty.hidden = false;
      DOM.historyEmpty.removeAttribute("aria-hidden");
      DOM.historyList.dataset.empty = "true";
      DOM.historyList.setAttribute("aria-hidden", "true");
      return;
    }

    DOM.historyEmpty.hidden = true;
    DOM.historyEmpty.setAttribute("aria-hidden", "true");
    delete DOM.historyList.dataset.empty;
    DOM.historyList.removeAttribute("aria-hidden");

    let animIndex = 0;
    groupHistoryByDate(items).forEach((group) => {
      const section = el("section", "history-group");
      section.setAttribute("aria-label", group.label);
      section.appendChild(el("h3", "history-group__title", group.label));

      const list = el("ul", "history-group__list");
      list.setAttribute("role", "list");

      group.items.forEach(({ entry, index }) => {
        const li = el("li", "history-group__item");
        const btn = el("button", "history-item");
        btn.type = "button";
        if (index === 0) btn.classList.add("history-item--newest");
        if (state.selectedHistoryIndex === index) btn.classList.add("is-selected");
        btn.dataset.index = String(index);
        btn.style.animationDelay = `${Math.min(animIndex, 14) * 0.028}s`;
        btn.setAttribute(
          "aria-label",
          `Use result ${formatNumber(entry.result)}. ${formatHistoryExpression(entry.expression)}. ${formatAbsoluteTime(entry.timestamp)}`
        );

        const top = el("div", "history-item__top");
        top.appendChild(
          el(
            "span",
            "history-item__expression",
            formatHistoryExpression(entry.expression)
          )
        );

        const time = el("time", "history-item__time");
        time.dateTime = new Date(entry.timestamp).toISOString();
        time.title = new Date(entry.timestamp).toLocaleString();
        time.appendChild(
          el("span", "history-item__time-abs", formatAbsoluteTime(entry.timestamp))
        );
        time.appendChild(
          el("span", "history-item__time-rel", formatRelativeTime(entry.timestamp))
        );
        top.appendChild(time);

        const bottom = el("div", "history-item__bottom");
        const equals = el("span", "history-item__equals", "=");
        equals.setAttribute("aria-hidden", "true");
        bottom.append(
          equals,
          el("span", "history-item__result", formatNumber(entry.result)),
          el("span", "history-item__use", "Use")
        );

        btn.append(top, bottom);
        li.appendChild(btn);
        list.appendChild(li);
        animIndex += 1;
      });

      section.appendChild(list);
      DOM.historyList.appendChild(section);
    });

    if (scrollToNewest) {
      requestAnimationFrame(() => {
        scrollToNewestHistory(instantScroll ? "auto" : "smooth");
      });
    }
  };

  const addHistoryEntry = (expression, result) => {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      expression,
      result,
      timestamp: Date.now(),
    };
    const latest = state.history[0];
    if (
      latest &&
      latest.expression === expression &&
      latest.result === result
    ) {
      latest.timestamp = entry.timestamp;
      latest.id = entry.id;
    } else {
      state.history.unshift(entry);
      if (state.history.length > HISTORY_LIMIT) {
        state.history.length = HISTORY_LIMIT;
      }
    }
    state.selectedHistoryIndex = 0;
    persistHistory();
    renderHistory({ scrollToNewest: state.historyOpen });
  };

  const clearHistory = () => {
    if (state.history.length === 0) return;
    if (
      !window.confirm("Clear all calculation history? This cannot be undone.")
    ) {
      return;
    }
    state.history = [];
    state.selectedHistoryIndex = null;
    persistHistory();
    renderHistory();
    announce("History cleared");
  };

  const getFocusableIn = (root) => {
    if (!root) return [];
    return Array.from(
      root.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((node) => {
      if (node.hasAttribute("disabled")) return false;
      const style = window.getComputedStyle(node);
      return style.visibility !== "hidden" && style.display !== "none";
    });
  };

  const trapHistoryFocus = (event) => {
    if (!state.historyOpen || event.key !== "Tab") return;
    const focusable = getFocusableIn(DOM.historyPanel);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const setHistoryOpen = (open) => {
    state.historyOpen = open;
    DOM.historyPanel.setAttribute("aria-hidden", String(!open));
    DOM.historyBackdrop.setAttribute("aria-hidden", String(!open));
    DOM.historyToggle.setAttribute("aria-expanded", String(open));
    DOM.historyToggle.setAttribute(
      "aria-label",
      open ? "Close calculation history" : "Open calculation history"
    );
    DOM.historyToggle.classList.toggle("is-active", open);

    if (DOM.container) {
      if (open) {
        DOM.container.setAttribute("aria-hidden", "true");
        DOM.container.setAttribute("inert", "");
      } else {
        DOM.container.removeAttribute("aria-hidden");
        DOM.container.removeAttribute("inert");
      }
    }

    window.clearTimeout(historyCloseTimer);

    if (open) {
      DOM.historyPanel.removeAttribute("inert");
      DOM.historyBackdrop.hidden = false;
      document.body.classList.add("history-open");
      renderHistory({ scrollToNewest: true, instantScroll: true });
      requestAnimationFrame(() => {
        DOM.historyPanel.classList.add("is-open");
        DOM.historyBackdrop.classList.add("is-open");
      });
      DOM.historyClose.focus();
      announce("History panel opened");
    } else {
      DOM.historyPanel.classList.remove("is-open");
      DOM.historyBackdrop.classList.remove("is-open");
      DOM.historyPanel.setAttribute("inert", "");
      document.body.classList.remove("history-open");
      historyCloseTimer = window.setTimeout(() => {
        if (!state.historyOpen) DOM.historyBackdrop.hidden = true;
      }, 400);
      DOM.historyToggle.focus();
    }
  };

  const useHistoryEntry = (index) => {
    const entry = state.history[index];
    if (!entry) return;
    state.selectedHistoryIndex = index;
    state.expression = String(entry.result);
    setDisplayResult(entry.result);
    DOM.expressionDisplay.textContent = formatHistoryExpression(
      entry.expression
    );
    animateCommittedResult();
    renderHistory();
    setHistoryOpen(false);
    announce(`Using result ${formatNumber(entry.result)}`);
  };

  // ---------------------------------------------------------------------------
  // Memory
  // ---------------------------------------------------------------------------

  const getDisplayValue = () => {
    if (!state.expression) return 0;
    try {
      return evaluateExpression(state.expression);
    } catch {
      const n = Number(state.expression);
      return Number.isFinite(n) ? n : 0;
    }
  };

  const hasMemory = () =>
    state.memory !== null && Number.isFinite(state.memory);

  const updateMemoryUI = () => {
    const active = hasMemory();
    if (DOM.memoryIndicator) {
      DOM.memoryIndicator.hidden = !active;
      if (active) {
        DOM.memoryIndicator.title = `Memory: ${formatNumber(state.memory)}`;
        const sr = DOM.memoryIndicator.querySelector(".sr-only");
        if (sr) sr.textContent = `Memory stored: ${formatNumber(state.memory)}`;
      }
    }
    DOM.memoryButtons?.forEach((btn) => {
      const op = btn.dataset.memory;
      if (op === "MC" || op === "MR") btn.disabled = !active;
    });
  };

  const setMemory = (value) => {
    state.memory =
      value === null || !Number.isFinite(value) ? null : value;
    updateMemoryUI();
  };

  const handleMemoryAction = (action) => {
    clearErrorIfNeeded();
    switch (action) {
      case "MC":
        setMemory(null);
        announce("Memory cleared");
        break;
      case "MR":
        if (!hasMemory()) return;
        state.expression = String(state.memory);
        setDisplayResult(state.memory);
        updateDisplay();
        animateCommittedResult();
        announce(`Memory recalled: ${formatNumber(state.memory)}`);
        break;
      case "MS": {
        const value = getDisplayValue();
        setMemory(value);
        announce(`Memory stored: ${formatNumber(value)}`);
        break;
      }
      case "M+": {
        const next = (hasMemory() ? state.memory : 0) + getDisplayValue();
        setMemory(next);
        announce(`Memory add. Memory is ${formatNumber(next)}`);
        break;
      }
      case "M-": {
        const next = (hasMemory() ? state.memory : 0) - getDisplayValue();
        setMemory(next);
        announce(`Memory subtract. Memory is ${formatNumber(next)}`);
        break;
      }
      default:
        break;
    }
  };

  // ---------------------------------------------------------------------------
  // Equals & copy
  // ---------------------------------------------------------------------------

  const handleEqualsAction = () => {
    if (!state.expression) return;
    const source = state.expression;
    try {
      const result = evaluateExpression(source);
      addHistoryEntry(source, result);
      // Keep raw value for chaining; show formatted result only after Equals
      state.expression = String(result);
      setDisplayResult(result);
      DOM.expressionDisplay.textContent = formatNumber(result);
      animateCommittedResult();
      announce(`Result: ${formatNumber(result)}`);
    } catch {
      state.expression = "";
      setDisplayResult("0");
      DOM.expressionDisplay.textContent = "Error!";
      playMotion(DOM.expressionDisplay, "is-updating", 300);
      announce("Error in expression");
    }
  };

  const handleCopyClick = async () => {
    const resultText = DOM.resultDisplay.textContent;
    if (!resultText || resultText === "0" || resultText === "Error!") return;
    const cleanValue = resultText.replace(/,/g, "");
    try {
      await navigator.clipboard.writeText(cleanValue);
      DOM.copyButton.classList.remove("copied");
      void DOM.copyButton.offsetWidth;
      DOM.copyButton.classList.add("copied");
      DOM.copyButton.setAttribute("aria-label", "Result copied to clipboard");
      announce(`Copied ${cleanValue}`);
      window.clearTimeout(copyResetTimer);
      copyResetTimer = window.setTimeout(() => {
        DOM.copyButton.classList.remove("copied");
        DOM.copyButton.setAttribute("aria-label", "Copy result to clipboard");
      }, 1400);
    } catch {
      announce("Copy failed");
    }
  };

  // ---------------------------------------------------------------------------
  // Mode & theme
  // ---------------------------------------------------------------------------

  const setScientificInert = (isScientific) => {
    if (!DOM.scientificPanel) return;
    if (isScientific) {
      DOM.scientificPanel.removeAttribute("inert");
      DOM.scientificPanel.setAttribute("aria-hidden", "false");
    } else {
      DOM.scientificPanel.setAttribute("inert", "");
      DOM.scientificPanel.setAttribute("aria-hidden", "true");
      if (DOM.scientificPanel.contains(document.activeElement)) {
        DOM.modeToggle
          ?.querySelector('[data-mode="standard"]')
          ?.focus();
      }
    }
  };

  const applyModeUI = (isScientific) => {
    DOM.modeToggle.classList.toggle("is-scientific", isScientific);
    DOM.scientificPanel.classList.toggle("is-open", isScientific);
    DOM.container.classList.toggle("is-scientific", isScientific);
    DOM.calculator.classList.toggle("is-scientific", isScientific);
    setScientificInert(isScientific);
    if (DOM.modeLabel) {
      DOM.modeLabel.textContent = isScientific
        ? "Scientific mode"
        : "Standard mode";
    }
    DOM.modeToggle.querySelectorAll(".mode-toggle__option").forEach((btn) => {
      const active =
        btn.dataset.mode === (isScientific ? "scientific" : "standard");
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  };

  const setMode = (mode) => {
    state.isScientific = mode === "scientific";
    localStorage.setItem(
      STORAGE.mode,
      state.isScientific ? "scientific" : "standard"
    );
    applyModeUI(state.isScientific);
    announce(state.isScientific ? "Scientific mode" : "Standard mode");
  };

  const applyTheme = (theme) => {
    const resolved = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", resolved);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute(
        "content",
        resolved === "dark" ? "#0f3040" : "#266210"
      );
    }
    if (DOM.themeButton) {
      const next = resolved === "dark" ? "light" : "dark";
      const label = `Switch to ${next} theme`;
      DOM.themeButton.setAttribute("aria-label", label);
      DOM.themeButton.setAttribute("title", label);
      DOM.themeButton.setAttribute(
        "aria-pressed",
        String(resolved === "dark")
      );
    }
  };

  const setTheme = (theme) => {
    state.theme = theme === "dark" ? "dark" : "light";
    localStorage.setItem(STORAGE.theme, state.theme);
    applyTheme(state.theme);
    announce(`${state.theme} theme`);
  };

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  const flashButtonPress = (button) => {
    if (!button || REDUCED_MOTION()) return;
    button.classList.add("is-pressed");
    window.setTimeout(() => button.classList.remove("is-pressed"), 100);
  };

  const handleButtonClick = (event) => {
    const button = event.target.closest("button");
    if (!button || !DOM.calculator.contains(button)) return;

    if (
      button.classList.contains("mode-toggle__option") ||
      button.classList.contains("calculator__theme-btn") ||
      button.classList.contains("calculator__icon-btn") ||
      button.id === "copyButton"
    ) {
      return;
    }

    const { value, function: fn, memory } = button.dataset;
    const { id } = button;

    if (id === "equalsButton") handleEqualsAction();
    else if (id === "clearButton") clearExpressionWithAnnounce();
    else if (id === "backspaceButton") {
      clearErrorIfNeeded();
      state.expression = state.expression.slice(0, -1);
      updateDisplay();
    } else if (memory) handleMemoryAction(memory);
    else if (fn) handleScientificFunction(fn);
    else if (value !== undefined) appendToExpression(value);
  };

  const findKeyButton = (key) => {
    if (key === "Enter" || key === "=") return DOM.equalsButton;
    if (key === "Escape" || key === "Delete") return DOM.clearButton;
    if (key === "Backspace") return DOM.backspaceButton;
    try {
      return DOM.calculator.querySelector(
        `.calculator__pad--standard [data-value="${CSS.escape(key)}"]`
      );
    } catch {
      return null;
    }
  };

  const isTypingTarget = (el) => {
    if (!el || el === document.body) return false;
    const tag = el.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      el.isContentEditable
    );
  };

  const isButtonLike = (el) =>
    Boolean(el?.closest("button, a[href], [role='button']"));

  // ---------------------------------------------------------------------------
  // Splash, About, Welcome
  // ---------------------------------------------------------------------------

  const setModalOpen = (dialog, backdrop, open, { onCloseFocus } = {}) => {
    if (!dialog || !backdrop) return;
    dialog.setAttribute("aria-hidden", String(!open));
    backdrop.setAttribute("aria-hidden", String(!open));
    dialog.classList.toggle("is-open", open);
    backdrop.classList.toggle("is-open", open);

    if (open) {
      dialog.removeAttribute("inert");
      backdrop.hidden = false;
      document.body.classList.add("history-open");
      const focusTarget =
        dialog.querySelector(".modal__primary, .modal__close") || dialog;
      focusTarget.focus();
    } else {
      dialog.setAttribute("inert", "");
      backdrop.classList.remove("is-open");
      dialog.classList.remove("is-open");
      window.setTimeout(() => {
        if (dialog.getAttribute("aria-hidden") === "true") {
          backdrop.hidden = true;
        }
      }, 320);
      if (!state.historyOpen && !state.aboutOpen && !state.welcomeOpen) {
        document.body.classList.remove("history-open");
      }
      onCloseFocus?.focus?.();
    }
  };

  const setAboutOpen = (open) => {
    state.aboutOpen = open;
    setModalOpen(DOM.aboutDialog, DOM.aboutBackdrop, open, {
      onCloseFocus: DOM.aboutToggle,
    });
    if (open) announce("About TROVE Calc");
  };

  const setWelcomeOpen = (open) => {
    state.welcomeOpen = open;
    setModalOpen(DOM.welcomeDialog, DOM.welcomeBackdrop, open, {
      onCloseFocus: DOM.equalsButton,
    });
  };

  const dismissWelcome = () => {
    try {
      localStorage.setItem(STORAGE.welcome, "1");
    } catch {
      /* ignore */
    }
    setWelcomeOpen(false);
    announce("Welcome dismissed. TROVE Calc is ready.");
  };

  const runSplash = () =>
    new Promise((resolve) => {
      const splash = DOM.splashScreen;
      if (!splash) {
        document.body.classList.remove("is-booting");
        resolve();
        return;
      }
      const delay = REDUCED_MOTION() ? 0 : SPLASH_MS;
      window.setTimeout(() => {
        splash.classList.add("is-done");
        document.body.classList.remove("is-booting");
        window.setTimeout(() => {
          splash.setAttribute("hidden", "");
          splash.setAttribute("aria-hidden", "true");
          resolve();
        }, REDUCED_MOTION() ? 0 : 450);
      }, delay);
    });

  const maybeShowWelcome = () => {
    let seen = false;
    try {
      seen = localStorage.getItem(STORAGE.welcome) === "1";
    } catch {
      seen = true;
    }
    if (!seen) setWelcomeOpen(true);
  };

  const registerServiceWorker = () => {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol === "file:") return;
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./service-worker.js", { scope: "./" })
        .catch(() => {});
    });
  };

  /** Mark installed / standalone sessions for CSS hooks */
  const detectStandalone = () => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    document.body.classList.toggle("is-standalone", standalone);
  };

  const trapModalFocus = (event, dialog) => {
    if (event.key !== "Tab" || !dialog) return;
    const focusable = getFocusableIn(dialog);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleKeyDown = (event) => {
    const { key, target } = event;

    if (state.welcomeOpen) {
      trapModalFocus(event, DOM.welcomeDialog);
      if (key === "Escape") {
        event.preventDefault();
        dismissWelcome();
      }
      return;
    }

    if (state.aboutOpen) {
      trapModalFocus(event, DOM.aboutDialog);
      if (key === "Escape") {
        event.preventDefault();
        setAboutOpen(false);
      }
      return;
    }

    if (state.historyOpen) {
      trapHistoryFocus(event);
      if (key === "Escape") {
        event.preventDefault();
        setHistoryOpen(false);
      }
      return;
    }

    if (isTypingTarget(target)) return;
    if ((key === "Enter" || key === " ") && isButtonLike(target)) return;

    if (key === "Escape") {
      flashButtonPress(findKeyButton(key));
      clearExpressionWithAnnounce();
      return;
    }
    if (key === "Enter" || key === "=") {
      event.preventDefault();
      flashButtonPress(findKeyButton(key));
      handleEqualsAction();
      return;
    }
    if (key === "Delete") {
      flashButtonPress(findKeyButton(key));
      clearExpressionWithAnnounce();
      return;
    }
    if (key === "Backspace") {
      event.preventDefault();
      flashButtonPress(findKeyButton(key));
      clearErrorIfNeeded();
      state.expression = state.expression.slice(0, -1);
      updateDisplay();
      return;
    }
    if (/^[0-9.+\-*/%^()]$/.test(key)) {
      event.preventDefault();
      flashButtonPress(findKeyButton(key));
      appendToExpression(key);
    }
  };

  const attachEventListeners = () => {
    DOM.calculator.addEventListener("click", handleButtonClick);
    DOM.copyButton.addEventListener("click", handleCopyClick);
    DOM.modeToggle.addEventListener("click", (event) => {
      const option = event.target.closest(".mode-toggle__option");
      if (option) setMode(option.dataset.mode);
    });
    DOM.themeButton.addEventListener("click", () => {
      setTheme(state.theme === "dark" ? "light" : "dark");
    });
    DOM.historyToggle.addEventListener("click", () =>
      setHistoryOpen(!state.historyOpen)
    );
    DOM.historyClose.addEventListener("click", () => setHistoryOpen(false));
    DOM.historyBackdrop.addEventListener("click", () => setHistoryOpen(false));
    DOM.historyClear.addEventListener("click", clearHistory);
    DOM.historyList.addEventListener("click", (event) => {
      const item = event.target.closest(".history-item");
      if (!item) return;
      const index = Number(item.dataset.index);
      if (!Number.isNaN(index)) useHistoryEntry(index);
    });

    DOM.aboutToggle?.addEventListener("click", () => setAboutOpen(true));
    DOM.aboutClose?.addEventListener("click", () => setAboutOpen(false));
    DOM.aboutDismiss?.addEventListener("click", () => setAboutOpen(false));
    DOM.aboutBackdrop?.addEventListener("click", () => setAboutOpen(false));
    DOM.welcomeStart?.addEventListener("click", dismissWelcome);
    DOM.welcomeBackdrop?.addEventListener("click", dismissWelcome);

    document.addEventListener("keydown", handleKeyDown);
  };

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  const cacheDOMElements = () => {
    DOM.expressionDisplay = document.getElementById("expressionDisplay");
    DOM.resultDisplay = document.getElementById("resultDisplay");
    DOM.calculator = document.getElementById("calculator");
    DOM.container = document.querySelector(".container");
    DOM.copyButton = document.getElementById("copyButton");
    DOM.modeToggle = document.getElementById("modeToggle");
    DOM.modeLabel = document.getElementById("modeLabel");
    DOM.scientificPanel = document.getElementById("scientificPanel");
    DOM.themeButton = document.getElementById("themeToggle");
    DOM.historyToggle = document.getElementById("historyToggle");
    DOM.historyPanel = document.getElementById("historyPanel");
    DOM.historyBackdrop = document.getElementById("historyBackdrop");
    DOM.historyList = document.getElementById("historyList");
    DOM.historyEmpty = document.getElementById("historyEmpty");
    DOM.historyCount = document.getElementById("historyCount");
    DOM.historyClear = document.getElementById("historyClear");
    DOM.historyClose = document.getElementById("historyClose");
    DOM.historyHint = document.getElementById("historyHint");
    DOM.memoryIndicator = document.getElementById("memoryIndicator");
    DOM.memoryButtons = document.querySelectorAll("[data-memory]");
    DOM.srAnnouncer = document.getElementById("srAnnouncer");
    DOM.equalsButton = document.getElementById("equalsButton");
    DOM.clearButton = document.getElementById("clearButton");
    DOM.backspaceButton = document.getElementById("backspaceButton");
    DOM.splashScreen = document.getElementById("splashScreen");
    DOM.aboutToggle = document.getElementById("aboutToggle");
    DOM.aboutDialog = document.getElementById("aboutDialog");
    DOM.aboutBackdrop = document.getElementById("aboutBackdrop");
    DOM.aboutClose = document.getElementById("aboutClose");
    DOM.aboutDismiss = document.getElementById("aboutDismiss");
    DOM.welcomeDialog = document.getElementById("welcomeDialog");
    DOM.welcomeBackdrop = document.getElementById("welcomeBackdrop");
    DOM.welcomeStart = document.getElementById("welcomeStart");
  };

  const init = async () => {
    cacheDOMElements();
    detectStandalone();
    applyTheme(state.theme);
    applyModeUI(state.isScientific);
    DOM.historyPanel?.setAttribute("inert", "");
    DOM.historyPanel?.setAttribute("aria-hidden", "true");
    renderHistory();
    updateMemoryUI();
    attachEventListeners();
    updateDisplay();
    registerServiceWorker();
    await runSplash();
    maybeShowWelcome();
  };

  return { init };
})();

document.addEventListener("DOMContentLoaded", () => {
  Calculator.init();
});
