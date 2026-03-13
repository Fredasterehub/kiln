const form = document.getElementById("todo-form");
const input = document.getElementById("todo-input");
const list = document.getElementById("todo-list");

const todos = JSON.parse(localStorage.getItem("todos") || "[]");

function render() {
  list.innerHTML = "";
  todos.forEach((todo, index) => {
    const item = document.createElement("li");
    item.innerHTML = `<span>${todo}</span><button data-index="${index}">Done</button>`;
    list.appendChild(item);
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!input.value.trim()) return;
  todos.push(input.value.trim());
  localStorage.setItem("todos", JSON.stringify(todos));
  input.value = "";
  render();
});

list.addEventListener("click", (event) => {
  if (event.target.matches("button")) {
    todos.splice(Number(event.target.dataset.index), 1);
    localStorage.setItem("todos", JSON.stringify(todos));
    render();
  }
});

render();
