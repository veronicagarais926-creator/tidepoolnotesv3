(function () {
  'use strict';
  const toast = document.getElementById('toast');
  const feedList = document.getElementById('feed-list');
  const postForm = document.getElementById('post-form');
  const captionInput = document.getElementById('post-caption');
  const composeJumpBtn = document.getElementById('compose-jump');
  const photoInput = document.getElementById('post-photo');
  const choosePhotoBtn = document.getElementById('choose-post-photo');

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.setTimeout(function () { toast.classList.remove('is-visible'); }, 2800);
  }

  // Switch Between Nav Views (Feed, Discover, Friends, Chats, Profile, Notes)
  function activateView(view) {
    if (!['feed', 'discover', 'friends', 'chats', 'profile', 'notes'].includes(view)) return;
    document.body.dataset.view = view;

    document.querySelectorAll('[data-view-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.viewPanel !== view;
    });

    document.querySelectorAll('.nav-item').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.view === view);
    });

    const breadcrumbSection = document.getElementById('breadcrumb-section');
    const breadcrumbTitle = document.getElementById('breadcrumb-title');

    if (breadcrumbSection) {
      breadcrumbSection.textContent = view === 'notes' ? 'My notebook' : 'Community';
    }

    if (breadcrumbTitle) {
      breadcrumbTitle.textContent = {
        feed: 'A space for you to think',
        discover: 'Discover People',
        friends: 'Your Tideline',
        chats: 'Private Chats',
        profile: 'Your Profile',
        notes: 'Personal Notes'
      }[view] || 'A space for you to think';
    }
  }

  // Attach Navigation Listeners
  document.querySelectorAll('.nav-item').forEach(function (button) {
    button.addEventListener('click', function () {
      activateView(button.dataset.view);
    });
  });

  // Compose Jump (+ New Post Button)
  if (composeJumpBtn) {
    composeJumpBtn.addEventListener('click', function () {
      activateView('feed');
      if (postForm) postForm.hidden = !postForm.hidden;
      if (captionInput) captionInput.focus();
    });
  }

  // File Choice Trigger
  if (choosePhotoBtn && photoInput) {
    choosePhotoBtn.addEventListener('click', function () {
      photoInput.click();
    });
  }

  // Post Submission Functionality
  if (postForm) {
    postForm.addEventListener('submit', function (event) {
      event.preventDefault();
      const text = captionInput ? captionInput.value.trim() : '';
      if (!text && (!photoInput || !photoInput.files.length)) return;

      // Create new post element
      const card = document.createElement('div');
      card.className = 'mock-post-card';
      card.style.padding = '20px';
      card.style.borderRadius = '8px';
      card.style.color = '#14599a';
      card.style.fontSize = '16px';
      card.style.lineHeight = '1.6';

      const paragraph = document.createElement('p');
      paragraph.style.margin = '0 0 10px 0';
      paragraph.textContent = text;
      card.appendChild(paragraph);

      // Handle attached image display
      if (photoInput && photoInput.files.length) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(photoInput.files[0]);
        img.style.maxWidth = '100%';
        img.style.maxHeight = '240px';
        img.style.borderRadius = '6px';
        img.style.objectFit = 'cover';
        card.appendChild(img);
      }

      if (feedList) {
        feedList.prepend(card);
      }

      // Reset form
      postForm.reset();
      postForm.hidden = true;
      showToast('Post created!');
    });
  }

  // Activate default view on load
  activateView('feed');
}());