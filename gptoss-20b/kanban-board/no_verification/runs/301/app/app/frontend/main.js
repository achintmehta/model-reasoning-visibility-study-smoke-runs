// Main JS for Kanban board
const API = 'http://localhost:4000/api';
let boardElem = document.getElementById('board');
init();
function init(){
  fetchBoard();
  setupSSE();
}
async function fetchBoard(){
  const res = await fetch(`${API}/board`);
  const board = await res.json();
  renderBoard(board);
}
function renderBoard(board){
  boardElem.innerHTML='';
  board.forEach(col => {
    const colEl = createColumn(col);
    boardElem.appendChild(colEl);
  });
}
function createColumn(col){
  const el = document.createElement('div');
  el.className='column';
  el.dataset.id=col.id;
  el.innerHTML=`<div class='column-title'>${col.title}</div>`;
  const cardsEl=document.createElement('div');
  el.appendChild(cardsEl);
  col.cards.forEach(card=>{
    const cardEl=createCard(card);
    cardsEl.appendChild(cardEl);
  });
  // Add card form
  const addForm=document.createElement('div');
  addForm.className='add-card';
  const input=document.createElement('input');
  input.type='text';input.placeholder='Add card';
  const addBtn=document.createElement('button');addBtn.textContent='Add';
  addForm.appendChild(input);addForm.appendChild(addBtn);
  addBtn.onclick=()=>{addCard(col.id,input.value);input.value='';};
  el.appendChild(addForm);
  // Drag and drop
  cardsEl.addEventListener('dragstart',onDragStart);
  cardsEl.addEventListener('dragover',onDragOver);
  cardsEl.addEventListener('drop',onDrop);
  cardsEl.addEventListener('dragend',onDragEnd);
  return el;
}
function createCard(card){
  const el=document.createElement('div');
  el.className='card';
  el.draggable=true;
  el.dataset.id=card.id;
  el.textContent=card.text;
  return el;
}
let draggedCard=null;
function onDragStart(e){
  draggedCard=e.target;
  e.target.classList.add('dragging');
}
function onDragOver(e){
  e.preventDefault();
  const target=e.target.closest('.card');
  if(!target || target===draggedCard)return;
  const cardsEl=e.currentTarget;
  if(cardsEl.children.length===0){
    cardsEl.appendChild(draggedCard);
    return;
  }
  const rect=target.getBoundingClientRect();
  const next=e.clientY>rect.top+rect.height/2;
  cardsEl.insertBefore(draggedCard, next? target.nextSibling: target);
}
function onDrop(e){
  e.preventDefault();
  const cardsEl=e.currentTarget;
  const targetId=parseInt(draggedCard.dataset.id,10);
  const columnId=parseInt(cardsEl.parentElement.dataset.id,10);
  const beforeId=null;
  const afterId=null;
  const beforeEl=cardsEl.nextElementSibling;
  if(beforeEl){beforeId=parseInt(beforeEl.dataset.id,10);} else {
    // we are at the end, set afterId to last card
    const last=cardsEl.lastElementChild;
    if(last){afterId=parseInt(last.dataset.id,10);} else {afterId=null;}
  }
  sendMove(targetId,columnId,beforeId,afterId);
  draggedCard.classList.remove('dragging');
  draggedCard=null;
}
function onDragEnd(e){
  e.target.classList.remove('dragging');
}
async function addCard(colId,text){
  if(!text) return;
  const res=await fetch(`${API}/cards`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({columnId:colId,text})});
  const card=await res.json();
  // optimistic? will be updated by SSE
}
async function sendMove(id,columnId,beforeId,afterId){
  await fetch(`${API}/cards/${id}/move`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({columnId,beforeId,afterId})});
}
function setupSSE(){
  const evt=new EventSource(`${API}/stream`);
  evt.onmessage=function(e){const data=JSON.parse(e.data); if(data.type==='create'){handleCreate(data.data);}else if(data.type==='move'){handleMove(data.data);} };
}
function handleCreate(card){
  const colEl=document.querySelector(`.column[data-id='${card.columnId}']`);
  const cardsEl=colEl.querySelector('div');
  const cardEl=createCard(card);
  cardsEl.appendChild(cardEl);
}
function handleMove(card){
  const cardEl=document.querySelector(`.card[data-id='${card.id}']`);
  if(!cardEl) return;
  const newColEl=document.querySelector(`.column[data-id='${card.columnId}']`);
  const cardsEl=newColEl.querySelector('div');
  cardEl.remove();
  cardsEl.appendChild(cardEl); // naive: append to end
}
