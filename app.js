(function () {
  'use strict';
  const STORAGE_KEY = 'tidepool-notes-v1';
  const cloudConfig = window.TIDEPOOL_SUPABASE_CONFIG || {};
  const cloudConfigured = Boolean(cloudConfig.url && cloudConfig.anonKey);
  const cloudEnabled = cloudConfigured && Boolean(window.supabase);
  const supabaseClient = cloudEnabled ? window.supabase.createClient(cloudConfig.url, cloudConfig.anonKey) : null;

  // UI Elements
  const appShell = document.getElementById('app-shell');
  const cloudGate = document.getElementById('cloud-gate');
  const editor = document.getElementById('editor-content');
  const titleInput = document.getElementById('note-title');
  const listElement = document.getElementById('note-list');
  const searchInput = document.getElementById('search');
  const sortSelect = document.getElementById('sort-notes-select');
  const toggleAuthBtn = document.getElementById('toggle-auth-mode');
  const authTitle = document.getElementById('auth-title');
  const signInButton = document.getElementById('sign-in-button');
  const toastElement = document.getElementById('toast');

  let saveTimer;
  let toastTimer;
  let activeFilter = 'all';
  let activeSort = 'newest';
  let activeNoteId;
  let cloudSession = null;
  let isSignUpMode = false;
  let notes = loadNotes();

  function createId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function starterNote() {
    const now = Date.now();
    return {
      id: createId(),
      title: 'A little space to think',
      body: '<p>Somewhere between the tide coming in and going out, there is room to breathe.</p><p>This is your little corner of the internet.</p>',
      pinned: false,
      createdAt: now,
      updatedAt: now
    };
  }

  function readStoredNotes(key) {
    try {
      const stored = JSON.parse(localStorage.getItem(key));
      return Array.isArray(stored) ? stored : [];
    } catch (error) {
      showToast('Saved notes could not be read.');
      return [];
    }
  }

  function loadNotes() {
    const stored = readStoredNotes(STORAGE_KEY);
    if (stored.length) return stored;
    const firstNote = starterNote();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([firstNote])); } catch (e) { /* local storage full/disabled */ }
    return [firstNote];
  }

  function currentNote() {
    return notes.find(function (note) { return note.id === activeNoteId; });
  }

  function plainText(html) {
    const temporary = document.createElement('div');
    temporary.innerHTML = html;
    return (temporary.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function formatDate(timestamp) {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(timestamp));
  }

  function showToast(message) {
    if (!toastElement) return;
    toastElement.textContent = message;
    toastElement.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toastElement.classList.remove('is-visible'); }, 2600);
  }

  // Render & Sort Note List
  function renderList() {
    if (!listElement) return;
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    
    const sortedNotes = notes.slice().sort(function (left, right) {
      if (left.pinned !== right.pinned) return Number(right.pinned) - Number(left.pinned);
      
      if (activeSort === 'newest') return right.updatedAt - left.updatedAt;
      if (activeSort === 'oldest') return left.updatedAt - right.updatedAt;
      if (activeSort === 'title-asc') return (left.title || '').localeCompare(right.title || '');
      if (activeSort === 'title-desc') return (right.title || '').localeCompare(left.title || '');
      return 0;
    });

    const visibleNotes = sortedNotes.filter(function (note) {
      const matchesFilter = activeFilter !== 'pinned' || note.pinned;
      return matchesFilter && (!query || (note.title + ' ' + plainText(note.body)).toLowerCase().includes(query));
    });

    listElement.replaceChildren();

    if (!visibleNotes.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-list';
      empty.textContent = query ? 'No notes match that search.' : 'No notes yet.';
      listElement.appendChild(empty);
      return;
    }

    visibleNotes.forEach(function (note) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'note-item' + (note.id === activeNoteId ? ' is-selected' : '');
      
      const noteTitle = document.createElement('span');
      noteTitle.className = 'note-item-title';
      noteTitle.textContent = note.title || 'Untitled note';
      
      button.appendChild(noteTitle);

      if (note.pinned) {
        const pin = document.createElement('span');
        pin.className = 'note-item-pin';
        pin.textContent = ' 📌';
        button.appendChild(pin);
      }

      button.addEventListener('click', function () { openNote(note.id); });
      listElement.appendChild(button);
    });
  }

  function openNote(id) {
    const note = notes.find(function (item) { return item.id === id; });
    if (!note) return;
    activeNoteId = id;
    if (titleInput) titleInput.value = note.title;
    if (editor) editor.innerHTML = note.body;
    
    const breadcrumbTitle = document.getElementById('breadcrumb-title');
    if (breadcrumbTitle) breadcrumbTitle.textContent = note.title || 'Untitled note';
    
    const dateElement = document.getElementById('note-date');
    if (dateElement) dateElement.textContent = formatDate(note.updatedAt).toUpperCase();

    renderList();
  }

  function scheduleSave() {
    const note = currentNote();
    if (!note) return;
    if (titleInput) note.title = titleInput.value;
    if (editor) note.body = editor.innerHTML;
    note.updatedAt = Date.now();
    
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      saveTimer = null;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
      } catch (e) {
        showToast('Could not save note locally.');
      }
    }, 350);
    renderList();
  }

  // Format Text Editor Controls
  document.querySelectorAll('.format-button').forEach(function (button) {
    button.addEventListener('click', function () {
      if (!editor) return;
      editor.focus();
      document.execCommand(button.dataset.command, false, null);
      scheduleSave();
    });
  });

  // Sort Selector Function
  if (sortSelect) {
    sortSelect.addEventListener('change', function () {
      activeSort = sortSelect.value;
      renderList();
    });
  }

  if (searchInput) searchInput.addEventListener('input', renderList);
  if (titleInput) titleInput.addEventListener('input', scheduleSave);
  if (editor) editor.addEventListener('input', scheduleSave);

  // New Note Creation
  const newNoteBtn = document.getElementById('new-note');
  if (newNoteBtn) {
    newNoteBtn.addEventListener('click', function () {
      const note = { id: createId(), title: '', body: '', pinned: false, createdAt: Date.now(), updatedAt: Date.now() };
      notes.unshift(note);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
      openNote(note.id);
      if (titleInput) titleInput.focus();
    });
  }

  // Save / Pin / Delete Note Buttons
  const saveNoteBtn = document.getElementById('save-note');
  if (saveNoteBtn) {
    saveNoteBtn.addEventListener('click', function () {
      scheduleSave();
      showToast('Note saved');
    });
  }

  const pinNoteBtn = document.getElementById('pin-note');
  if (pinNoteBtn) {
    pinNoteBtn.addEventListener('click', function () {
      const note = currentNote();
      if (!note) return;
      note.pinned = !note.pinned;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
      openNote(note.id);
    });
  }

  const deleteNoteBtn = document.getElementById('delete-note');
  if (deleteNoteBtn) {
    deleteNoteBtn.addEventListener('click', function () {
      if (!currentNote()) return;
      if (!window.confirm('Delete this note?')) return;
      notes = notes.filter(function (note) { return note.id !== activeNoteId; });
      if (!notes.length) notes.push(starterNote());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
      openNote(notes[0].id);
      showToast('Note deleted');
    });
  }

  // Authentication Flow Controls
  if (toggleAuthBtn) {
    toggleAuthBtn.addEventListener('click', function () {
      isSignUpMode = !isSignUpMode;
      if (isSignUpMode) {
        if (authTitle) authTitle.textContent = 'Create your Safe Space';
        if (signInButton) signInButton.textContent = 'Sign Up';
        toggleAuthBtn.textContent = 'Already have an account? Log In';
      } else {
        if (authTitle) authTitle.textContent = 'Welcome to your own Safe Space';
        if (signInButton) signInButton.textContent = 'Log In';
        toggleAuthBtn.textContent = 'New here? tap this button to Sign Up';
      }
    });
  }

  const signInForm = document.getElementById('sign-in-form');
  if (signInForm) {
    signInForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      const emailOrUser = document.getElementById('sign-in-email').value.trim();
      const password = document.getElementById('sign-in-password').value;
      const msg = document.getElementById('auth-message');

      if (msg) msg.textContent = isSignUpMode ? 'Creating account...' : 'Logging in...';

      if (!supabaseClient) {
        // Local Mode Access
        if (cloudGate) cloudGate.hidden = true;
        if (appShell) appShell.hidden = false;
        renderList();
        if (notes.length) openNote(notes[0].id);
        return;
      }

      try {
        let result = isSignUpMode 
          ? await supabaseClient.auth.signUp({ email: emailOrUser, password: password })
          : await supabaseClient.auth.signInWithPassword({ email: emailOrUser, password: password });

        if (result.error) {
          if (msg) msg.textContent = result.error.message;
        } else {
          cloudSession = result.data.session;
          if (cloudGate) cloudGate.hidden = true;
          if (appShell) appShell.hidden = false;
          renderList();
          if (notes.length) openNote(notes[0].id);
        }
      } catch (err) {
        if (msg) msg.textContent = 'Authentication error. Please try again.';
      }
    });
  }

  // Sign Out Control
  const signOutBtn = document.getElementById('sign-out');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async function () {
      if (supabaseClient) await supabaseClient.auth.signOut();
      cloudSession = null;
      if (appShell) appShell.hidden = true;
      if (cloudGate) cloudGate.hidden = false;
    });
  }

  // Initial Load
  renderList();
  if (notes.length) openNote(notes[0].id);
}());