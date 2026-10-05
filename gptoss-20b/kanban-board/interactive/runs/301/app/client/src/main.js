// Basic fetch and render
const boardDiv = document.getElementById('board');
const apiBase = 'http://localhost:3000/api';

async function loadBoard() {
  const res = await fetch(`${apiBase}/board`);
  const data = await res.json();
  boardDiv.innerHTML = '';
  data.forEach(col => {
    const colDiv = document.createElement('div');
    colDiv.className = 'column';
    colDiv.dataset.id = col.id;
    const title = document.createElement('h3');
    title.textContent = col.title;
    colDiv.appendChild(title);
    col.cards.forEach(card => {
      const cardDiv = document.createElement('div');
      cardDiv.className = 'card';
      cardDiv.dataset.id = card.id;
      cardDiv.textContent = card.text;
      colDiv.appendChild(cardDiv);
    });
    boardDiv.appendChild(colDiv);
  });
}

loadBoard();
