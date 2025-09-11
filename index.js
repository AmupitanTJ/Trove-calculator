// Select input field
const inputField = document.getElementById("displayInput");

// Select number buttons
const numberButtons = document.querySelectorAll(".number-button");

// Add event listener for number buttons
numberButtons.forEach((button) => {
  button.addEventListener("click", function () {
    inputField.value += this.getAttribute("data-value");
  });
});

// Select operator buttons
const operatorButtons = document.querySelectorAll(".operator-button");

// Add event listener for operator buttons
operatorButtons.forEach((button) => {
  button.addEventListener("click", function () {
    inputField.value += this.getAttribute("data-value");
  });
});

// Add event listener for "=" button to evaluate the expression
document.getElementById("equalsButton").addEventListener("click", function () {
  try {
    // Get the input value
    let expression = inputField.value;

    // Validate and compute the result using a safer function
    let result = calculate(expression);

    // Display the result
    inputField.value = result;
  } catch (error) {
    inputField.value = "Error!";
  }
});

// Function to safely evaluate mathematical expressions
function calculate(expression) {
  // Remove any spaces
  expression = expression.replace(/\s+/g, "");

  // Ensure the input contains only numbers and valid operators
  if (!/^[\d+\-*/.]+$/.test(expression)) {
    throw new Error("Invalid Expression");
  }

  // Perform calculations safely
  return new Function(`"use strict"; return (${expression})`)();
}

// Add event listener for "Clear" button
document.getElementById("clearButton").addEventListener("click", function () {
  inputField.value = "";
});


