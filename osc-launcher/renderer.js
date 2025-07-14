const { ipcRenderer } = require("electron");

let mappings = [];
let selectedIndex = null;

// DOM elements
const itemsEl = document.getElementById("items");
const addBtn = document.getElementById("add");
const saveBtn = document.getElementById("save");
const cancelBtn = document.getElementById("cancel");
const deleteBtn = document.getElementById("delete"); // ← new
const browseBtn = document.getElementById("browse");
const nameInput = document.getElementById("name");
const addrInput = document.getElementById("addr");
const filePathInput = document.getElementById("filePath");

async function loadMappings() {
  mappings = await ipcRenderer.invoke("get-mappings");
  selectedIndex = null;
  renderList();
  clearFields();
}

function renderList() {
  itemsEl.innerHTML = "";
  mappings.forEach((m, i) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.textContent = m.name && m.name.trim() ? m.name : m.address;
    div.onclick = () => editMapping(i);
    itemsEl.appendChild(div);
  });
}

function editMapping(i) {
  selectedIndex = i;

  // fill fields
  nameInput.value = mappings[i].name || "";
  addrInput.value = mappings[i].address;
  filePathInput.value = mappings[i].file;

  // enable Delete
  deleteBtn.disabled = false;
}

function deleteCurrent() {
  if (selectedIndex === null) return;
  mappings.splice(selectedIndex, 1);
  ipcRenderer.invoke("save-mappings", mappings).then(loadMappings);
}

function clearFields() {
  selectedIndex = null;
  nameInput.value = "";
  addrInput.value = "";
  filePathInput.value = "";
  deleteBtn.disabled = true; // disable when nothing selected
}

addBtn.onclick = () => {
  clearFields();
};

browseBtn.onclick = async () => {
  const file = await ipcRenderer.invoke("open-file-dialog");
  if (file) filePathInput.value = file;
};

saveBtn.onclick = async () => {
  const name = nameInput.value.trim();
  const addr = addrInput.value.trim();
  const file = filePathInput.value.trim();

  if (!addr || !file) {
    return alert("Both OSC address and file path are required.");
  }

  const entry = { name, address: addr, file };

  if (selectedIndex === null) {
    mappings.push(entry);
  } else {
    mappings[selectedIndex] = entry;
  }

  await ipcRenderer.invoke("save-mappings", mappings);
  loadMappings();
};

cancelBtn.onclick = clearFields;

deleteBtn.onclick = deleteCurrent; // ← hook up delete

// initial load
loadMappings();
