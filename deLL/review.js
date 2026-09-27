const reviewForm = document.querySelector('#review-form');
const toast = document.querySelector('#toast');
const approveTop = document.querySelector('#approve-top');

function approveRecord(event) {
  event?.preventDefault();
  const values = Object.fromEntries(new FormData(reviewForm).entries());
  localStorage.setItem('lekharxApprovedRecord', JSON.stringify({ ...values, approvedAt: new Date().toISOString(), version: 2 }));
  toast.textContent = 'Record approved. Opening audit history...';
  toast.classList.add('visible');
  setTimeout(() => { window.location.href = 'audit.html'; }, 850);
}

reviewForm?.addEventListener('submit', approveRecord);
approveTop?.addEventListener('click', approveRecord);
