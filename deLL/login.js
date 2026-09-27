const loginForm = document.querySelector('#login-form');

loginForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  sessionStorage.setItem('lekharxSession', 'active');
  window.location.href = 'index.html';
});
