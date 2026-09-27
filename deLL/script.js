const fileInput = document.querySelector('#document-file');
const dropZone = document.querySelector('#drop-zone');
const uploadStatus = document.querySelector('#upload-status');
const uploadButton = document.querySelector('#upload-button');
const cameraButton = document.querySelector('#camera-button');

function showFile(file) {
  if (!file) return;
  const validSize = file.size <= 10 * 1024 * 1024;
  if (!validSize) {
    uploadStatus.textContent = 'That file is larger than 10 MB. Choose a smaller source document.';
    uploadStatus.style.color = '#a66c18';
    return;
  }
  uploadStatus.textContent = `${file.name} selected. Ready for AI extraction.`;
  uploadStatus.style.color = '#147a83';
  sessionStorage.setItem('lekharxFileName', file.name);
  setTimeout(() => { window.location.href = 'review.html'; }, 450);
}

fileInput?.addEventListener('change', (event) => showFile(event.target.files[0]));
uploadButton?.addEventListener('click', () => fileInput?.click());
cameraButton?.addEventListener('click', () => {
  uploadStatus.textContent = 'Camera capture is ready in the connected app. Choose an image for this preview.';
  uploadStatus.style.color = '#147a83';
  fileInput?.click();
});
['dragenter', 'dragover'].forEach((eventName) => dropZone?.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((eventName) => dropZone?.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
}));
dropZone?.addEventListener('drop', (event) => showFile(event.dataTransfer.files[0]));
