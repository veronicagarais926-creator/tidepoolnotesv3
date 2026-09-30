(function () {
  'use strict';
  const STORAGE_KEY = 'tidepool-notes-v1';
  const FONT_KEY = 'tidepool-custom-font-v1';
  const cloudConfig = window.TIDEPOOL_SUPABASE_CONFIG || {};
  const cloudConfigured = Boolean(cloudConfig.url && cloudConfig.anonKey);
  const cloudEnabled = cloudConfigured && Boolean(window.supabase);
  const supabaseClient = cloudEnabled ? window.supabase.createClient(cloudConfig.url, cloudConfig.anonKey) : null;

  const appShell = document.getElementById('app-shell');
  const cloudGate = document.getElementById('cloud-gate');
  const editor = document.getElementById('editor-content');
  const titleInput = document.getElementById('note-title');
  const listElement = document.getElementById('note-list');
  const searchInput = document.getElementById('search');
  const saveIndicator = document.getElementById('save-indicator');
  const toastElement = document.getElementById('toast');
  const sortSelect = document.getElementById('sort-notes-select');
  const goToFeedBtn = document.getElementById('go-to-feed-btn');
  const toggleAuthBtn = document.getElementById('toggle-auth-mode');
  const authTitle = document.getElementById('auth-title');
  const signInButton = document.getElementById('sign-in-button');

  let saveTimer;
  let toastTimer;
  let activeFilter = 'all';
  let activeSort = 'newest';
  let activeNoteId;
  let cloudSession = null;
  let isSignUpMode = false;
  let cloudWriteQueue = Promise.resolve();
  let cloudWriteRevision = 0;
  let cloudWritePending = false;
  const pendingCloudRows = new Map();
  const pendingCloudDeletes = new Set();
  let notes = loadNotes();

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

  function createId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([firstNote])); } catch (error) { /* Storage unavailable */ }
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

  function renderList() {
    const query = searchInput.value.trim().toLowerCase();
    
    // Sort logic implementation
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

    document.getElementById('note-count').textContent = String(notes.length);
    listElement.replaceChildren();

    if (!visibleNotes.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-list';
      empty.textContent = query ? 'No notes match that search.' : 'Nothing pinned just yet.';
      listElement.appendChild(empty);
      return;
    }

    visibleNotes.forEach(function (note) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'note-item' + (note.id === activeNoteId ? ' is-selected' : '');
      button.setAttribute('aria-current', note.id === activeNoteId ? 'true' : 'false');
      
      const noteTitle = document.createElement('span');
      noteTitle.className = 'note-item-title';
      noteTitle.textContent = note.title || 'Untitled note';
      
      const preview = document.createElement('span');
      preview.className = 'note-item-preview';
      preview.textContent = plainText(note.body) || 'An empty page';
      
      const date = document.createElement('span');
      date.className = 'note-item-date';
      date.textContent = formatDate(note.updatedAt);
      
      button.append(noteTitle, preview, date);

      if (note.pinned) {
        const pin = document.createElement('span');
        pin.className = 'note-item-pin';
        pin.textContent = '📌';
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
    titleInput.value = note.title;
    editor.innerHTML = note.body;
    document.getElementById('breadcrumb-title').textContent = note.title || 'Untitled note';
    document.getElementById('note-date').textContent = formatDate(note.updatedAt).toUpperCase();
    const pinButton = document.getElementById('pin-note');
    pinButton.classList.toggle('is-pinned', note.pinned);
    updateWordCount();
    renderList();
  }

  function scheduleSave() {
    const note = currentNote();
    if (!note) return;
    note.title = titleInput.value;
    note.body = editor.innerHTML;
    note.updatedAt = Date.now();
    document.getElementById('breadcrumb-title').textContent = note.title || 'Untitled note';
    document.getElementById('note-date').textContent = formatDate(note.updatedAt).toUpperCase();
    saveIndicator.classList.add('is-saving');
    saveIndicator.innerHTML = '<span class="saved-dot"></span> Saving...';
    updateWordCount();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      saveTimer = null;
      saveNotes(note);
    }, 350);
    renderList();
  }

  function saveNotes(changedNotes, deletedId) {
    try {
      const storageKey = cloudSession ? STORAGE_KEY + ':' + cloudSession.user.id : STORAGE_KEY;
      localStorage.setItem(storageKey, JSON.stringify(notes));
    } catch (error) {
      showToast('Could not save note locally.');
    }
  }

  function updateWordCount() {
    const text = plainText(editor.innerHTML);
    const count = text ? text.split(/\s+/).length : 0;
    document.getElementById('word-count').textContent = count + (count === 1 ? ' word' : ' words');
  }

  function showToast(message) {
    toastElement.textContent = message;
    toastElement.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toastElement.classList.remove('is-visible'); }, 2600);
  }

  // Quick Action Buttons
  if (goToFeedBtn) {
    goToFeedBtn.addEventListener('click', function () {
      const feedNavBtn = document.getElementById('nav-feed-btn');
      if (feedNavBtn) feedNavBtn.click();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener('change', function () {
      activeSort = sortSelect.value;
      renderList();
    });
  }

  // Auth Toggle Mode (Log In <-> Sign Up)
  if (toggleAuthBtn) {
    toggleAuthBtn.addEventListener('click', function () {
      isSignUpMode = !isSignUpMode;
      if (isSignUpMode) {
        authTitle.textContent = 'Create your Safe Space';
        signInButton.textContent = 'Sign Up';
        toggleAuthBtn.textContent = 'Already have an account? Log In';
      } else {
        authTitle.textContent = 'Welcome to your own Safe Space';
        signInButton.textContent = 'Log In';
        toggleAuthBtn.textContent = 'New here? tap this button to Sign Up';
      }
    });
  }

  // Authentication Form Submit Handler
  document.getElementById('sign-in-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const emailOrUser = document.getElementById('sign-in-email').value.trim();
    const password = document.getElementById('sign-in-password').value;
    const msg = document.getElementById('auth-message');

    msg.textContent = isSignUpMode ? 'Creating account...' : 'Logging in...';

    if (!supabaseClient) {
      // Offline / Local storage fallback mode
      cloudGate.hidden = true;
      appShell.hidden = false;
      renderList();
      if (notes.length) openNote(notes[0].id);
      return;
    }

    try {
      let result;
      if (isSignUpMode) {
        result = await supabaseClient.auth.signUp({ email: emailOrUser, password: password });
      } else {
        result = await supabaseClient.auth.signInWithPassword({ email: emailOrUser, password: password });
      }

      if (result.error) {
        msg.textContent = result.error.message;
      } else {
        cloudGate.hidden = true;
        appShell.hidden = false;
        renderList();
        if (notes.length) openNote(notes[0].id);
      }
    } catch (err) {
      msg.textContent = 'Authentication error. Please try again.';
    }
  });

  // App Event Listeners
  document.getElementById('new-note').addEventListener('click', function () {
    const note = { id: createId(), title: '', body: '', pinned: false, createdAt: Date.now(), updatedAt: Date.now() };
    notes.unshift(note);
    saveNotes(note);
    openNote(note.id);
    titleInput.focus();
  });

  titleInput.addEventListener('input', scheduleSave);
  editor.addEventListener('input', scheduleSave);
  searchInput.addEventListener('input', renderList);

  document.querySelectorAll('.filter-tab').forEach(function (button) {
    button.addEventListener('click', function () {
      activeFilter = button.dataset.filter;
      document.querySelectorAll('.filter-tab').forEach(function (tab) { tab.classList.toggle('is-active', tab === button); });
      renderList();
    });
  });

  document.getElementById('save-note').addEventListener('click', function () {
    scheduleSave();
    showToast('Note saved');
  });

  document.getElementById('pin-note').addEventListener('click', function () {
    const note = currentNote();
    if (!note) return;
    note.pinned = !note.pinned;
    saveNotes(note);
    openNote(note.id);
  });

  document.getElementById('delete-note').addEventListener('click', function () {
    if (!currentNote()) return;
    if (!window.confirm('Delete this note?')) return;
    const deletedId = activeNoteId;
    notes = notes.filter(function (note) { return note.id !== activeNoteId; });
    if (!notes.length) notes.push(starterNote());
    saveNotes(notes, deletedId);
    openNote(notes[0].id);
    showToast('Note deleted');
  });

  // Initial Load Execution
  if (notes.length) {
    activeNoteId = notes[0].id;
    openNote(activeNoteId);
  }
}());