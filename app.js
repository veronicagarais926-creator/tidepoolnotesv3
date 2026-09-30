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
  let saveTimer;
  let toastTimer;
  let signInCooldownTimer;
  let signInCooldownUntil = 0;
  let activeFilter = 'all';
  let activeNoteId;
  let cloudSession = null;
  let cloudWriteQueue = Promise.resolve();
  let cloudWriteRevision = 0;
  let cloudWritePending = false;
  const pendingCloudRows = new Map();
  const pendingCloudDeletes = new Set();
  let notes = cloudConfigured ? [] : loadNotes();

  function starterNote() {
    const now = Date.now();
    return {
      id: createId(),
      title: 'A little space to think',
      body: '<p>Somewhere between the tide coming in and going out, there is room to breathe.</p><p>This is your little corner of the internet. Keep a thought, a list, a picture from today — whatever you want to come back to.</p><p><br></p><p>What is something small that made today feel like yours?</p>',
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
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([firstNote])); } catch (error) { /* Storage may be unavailable. */ }
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
    const visibleNotes = notes.slice().sort(function (left, right) {
      return Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt;
    }).filter(function (note) {
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
        pin.setAttribute('aria-label', 'Pinned');
        pin.textContent = '★';
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
    pinButton.innerHTML = '<span aria-hidden="true">' + (note.pinned ? '★' : '☆') + '</span>';
    pinButton.title = note.pinned ? 'Unpin note' : 'Pin note';
    pinButton.setAttribute('aria-label', pinButton.title);
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

  function setSaveState(label, saving) {
    saveIndicator.classList.toggle('is-saving', Boolean(saving));
    saveIndicator.innerHTML = '<span class="saved-dot"></span> ' + label;
    document.getElementById('storage-status').textContent = cloudSession ? label : 'Saved on this device';
  }

  function noteToRow(note) {
    return {
      id: note.id,
      user_id: cloudSession.user.id,
      title: note.title || '',
      body: note.body || '',
      pinned: Boolean(note.pinned),
      created_at: new Date(note.createdAt).toISOString(),
      updated_at: new Date(note.updatedAt).toISOString()
    };
  }

  function noteFromRow(row) {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      pinned: row.pinned,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime()
    };
  }

  function saveCloudRows(changedNotes, deletedId) {
    const userId = cloudSession.user.id;
    if (deletedId) {
      pendingCloudDeletes.add(deletedId);
      pendingCloudRows.delete(deletedId);
    }
    (Array.isArray(changedNotes) ? changedNotes : [changedNotes]).filter(Boolean).map(noteToRow).forEach(function (row) {
      pendingCloudDeletes.delete(row.id);
      pendingCloudRows.set(row.id, row);
    });
    const revision = ++cloudWriteRevision;
    cloudWritePending = true;
    setSaveState('Syncing...', true);
    const deletes = Array.from(pendingCloudDeletes);
    const rows = Array.from(pendingCloudRows.values());
    cloudWriteQueue = cloudWriteQueue.catch(function () { }).then(async function () {
      if (!cloudSession || cloudSession.user.id !== userId) return false;
      for (const id of deletes) {
        const deletion = await supabaseClient.from('notes').delete().eq('id', id);
        if (deletion.error) throw deletion.error;
      }
      if (rows.length) {
        const result = await supabaseClient.from('notes').upsert(rows, { onConflict: 'id' });
        if (result.error) throw result.error;
      }
      return true;
    }).then(function (didWrite) {
      if (!didWrite) return;
      deletes.forEach(function (id) { pendingCloudDeletes.delete(id); });
      rows.forEach(function (row) {
        if (pendingCloudRows.get(row.id) === row) pendingCloudRows.delete(row.id);
      });
      cloudWritePending = pendingCloudRows.size > 0 || pendingCloudDeletes.size > 0;
      if (revision === cloudWriteRevision && !cloudWritePending) {
        setSaveState('Synced to your account', false);
      }
    }).catch(function (error) {
      if (revision === cloudWriteRevision) {
        cloudWritePending = true;
        setSaveState('Sync paused', false);
        showToast('Saved on this device. Cloud sync failed: ' + error.message);
      }
    });
  }

  function saveNotes(changedNotes, deletedId) {
    try {
      const storageKey = cloudSession ? STORAGE_KEY + ':' + cloudSession.user.id : STORAGE_KEY;
      localStorage.setItem(storageKey, JSON.stringify(notes));
    } catch (error) {
      if (!cloudSession) {
        setSaveState('Storage is full', false);
        showToast('Could not save. Try removing a large picture.');
      }
    }
    if (cloudSession) {
      saveCloudRows(changedNotes || notes, deletedId);
    } else {
      setSaveState('All changes saved', false);
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

  function startSignInCooldown() {
    const button = document.getElementById('sign-in-button');
    const message = document.getElementById('auth-message');
    const buttonLabel = 'Email me a sign-in link';
    signInCooldownUntil = Date.now() + 60000;
    button.disabled = true;
    window.clearInterval(signInCooldownTimer);
    function updateCooldown() {
      const secondsLeft = Math.max(0, Math.ceil((signInCooldownUntil - Date.now()) / 1000));
      if (!secondsLeft) {
        window.clearInterval(signInCooldownTimer);
        button.disabled = false;
        button.textContent = buttonLabel;
        message.textContent = 'You can try requesting a link again.';
        return;
      }
      button.textContent = 'Wait ' + secondsLeft + 's to resend';
      message.textContent = 'Too many email requests were made. Please wait a little before trying again.';
    }
    updateCooldown();
    signInCooldownTimer = window.setInterval(updateCooldown, 1000);
  }

  function showCloudGate(message) {
    appShell.hidden = true;
    cloudGate.hidden = false;
    document.getElementById('auth-message').textContent = message;
  }

  function showPublicCommunity() {
    appShell.hidden = false;
    cloudGate.hidden = true;
    document.body.dataset.mode = 'social';
    document.body.dataset.view = 'feed';
    document.getElementById('guest-notice').hidden = false;
    document.getElementById('post-form').hidden = true;
    document.getElementById('guest-sign-in').hidden = false;
    document.getElementById('sign-out').hidden = true;
    document.getElementById('breadcrumb-section').textContent = 'Community';
    document.getElementById('breadcrumb-title').textContent = 'Public feed';
    document.getElementById('note-footer-meta').hidden = true;
    document.getElementById('footer-message').textContent = 'A little space for the moments worth sharing.';
    document.querySelectorAll('[data-view-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.viewPanel !== 'feed';
    });
    document.querySelectorAll('.nav-item').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.view === 'feed');
    });
  }

  async function loadCloudSession(session) {
    if (cloudSession && cloudSession.user.id === session.user.id && !appShell.hidden) return;
    cloudSession = session;
    appShell.hidden = false;
    cloudGate.hidden = true;
    document.body.dataset.mode = 'social';
    document.getElementById('sign-out').hidden = false;
    document.getElementById('guest-sign-in').hidden = true;
    document.getElementById('guest-notice').hidden = true;
    document.querySelector('.avatar').textContent = (session.user.email || 'M').charAt(0).toUpperCase();
    document.getElementById('privacy-label').textContent = 'Private to your account';
    setSaveState('Loading your notes...', true);

    const result = await supabaseClient.from('notes').select('id,title,body,pinned,created_at,updated_at').order('updated_at', { ascending: false });
    if (result.error) throw result.error;
    if (result.data.length) {
      notes = result.data.map(noteFromRow);
    } else {
      notes = readStoredNotes(STORAGE_KEY);
      if (!notes.length) notes = [starterNote()];
      localStorage.setItem(STORAGE_KEY + ':' + session.user.id, JSON.stringify(notes));
      saveCloudRows(notes);
      await cloudWriteQueue;
      if (cloudWritePending) throw new Error('Your existing notes could not be uploaded.');
    }

    activeNoteId = notes[0].id;
    localStorage.setItem(STORAGE_KEY + ':' + session.user.id, JSON.stringify(notes));
    openNote(activeNoteId);
    await restoreFont();
    document.body.dataset.view = 'feed';
    document.getElementById('note-footer-meta').hidden = true;
    document.getElementById('footer-message').textContent = 'A little space for the moments worth sharing.';
    if (!cloudWritePending) setSaveState('Synced to your account', false);
  }

  async function refreshCloudNotes() {
    if (!cloudSession || saveTimer) return;
    if (cloudWritePending) {
      if (navigator.onLine) saveCloudRows([], null);
      return;
    }
    const result = await supabaseClient.from('notes').select('id,title,body,pinned,created_at,updated_at').order('updated_at', { ascending: false });
    if (result.error) {
      setSaveState('Offline - saved on this device', false);
      return;
    }
    if (!result.data.length) return;
    notes = result.data.map(noteFromRow);
    activeNoteId = notes.some(function (note) { return note.id === activeNoteId; }) ? activeNoteId : notes[0].id;
    localStorage.setItem(STORAGE_KEY + ':' + cloudSession.user.id, JSON.stringify(notes));
    openNote(activeNoteId);
    await restoreFont();
    setSaveState('Synced to your account', false);
  }

  async function saveFontToCloud(name, data) {
    if (!cloudSession) return;
    const result = await supabaseClient.from('user_settings').upsert({
      user_id: cloudSession.user.id,
      font_name: name,
      font_data: data
    }, { onConflict: 'user_id' });
    if (result.error) showToast('Font saved here, but could not sync to your account.');
  }

  async function applyImportedFont(name, data) {
    const face = new FontFace('NotebookCustom', 'url("' + data + '")');
    const loaded = await face.load();
    document.fonts.add(loaded);
    document.documentElement.style.setProperty('--note-font', 'NotebookCustom, Georgia, serif');
    document.getElementById('font-label').textContent = name;
  }

  async function restoreFont() {
    let saved;
    let cloudFont;
    const accountFontKey = cloudSession ? FONT_KEY + ':' + cloudSession.user.id : FONT_KEY;
    try {
      if (cloudSession) {
        const result = await supabaseClient.from('user_settings').select('font_name,font_data').eq('user_id', cloudSession.user.id).maybeSingle();
        if (result.error) throw result.error;
        cloudFont = result.data;
        if (cloudFont && cloudFont.font_data) {
          saved = { name: cloudFont.font_name, data: cloudFont.font_data };
        }
      }
      if (!saved) {
        saved = JSON.parse(localStorage.getItem(accountFontKey) || 'null') || (cloudSession ? JSON.parse(localStorage.getItem(FONT_KEY) || 'null') : null);
      }
      if (!saved || !saved.data || !saved.name) return;
      await applyImportedFont(saved.name, saved.data);
      localStorage.setItem(accountFontKey, JSON.stringify(saved));
      if (cloudSession && !cloudFont) {
        await saveFontToCloud(saved.name, saved.data);
      }
    } catch (error) {
      showToast('The saved font could not be loaded or synced.');
    }
  }

  function startCloudApp() {
    if (!cloudConfigured) {
      document.body.dataset.mode = 'local';
      document.body.dataset.view = 'notes';
      document.querySelectorAll('[data-view-panel]').forEach(function (panel) {
        panel.hidden = panel.dataset.viewPanel !== 'notes';
      });
      document.getElementById('breadcrumb-section').textContent = 'My notebook';
      document.getElementById('guest-notice').hidden = true;
      document.getElementById('guest-sign-in').hidden = true;
      document.getElementById('note-footer-meta').hidden = false;
      activeNoteId = notes[0].id;
      openNote(activeNoteId);
      restoreFont();
      return;
    }
    if (!cloudEnabled) {
      showCloudGate('Cloud mode is configured, but the Supabase client did not load. Check your internet connection and reload.');
      return;
    }

    window.TIDEPOOL_SUPABASE = supabaseClient;
    showPublicCommunity();
    document.getElementById('guest-sign-in').addEventListener('click', function () {
      showCloudGate('Sign in or create an account to connect and share.');
    });
    document.querySelectorAll('[data-open-signin]').forEach(function (button) {
      button.addEventListener('click', function () {
        showCloudGate('Sign in or create an account to connect and share.');
      });
    });
    document.getElementById('sign-in-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      const button = document.getElementById('sign-in-button');
      if (Date.now() < signInCooldownUntil) return;
      button.disabled = true;
      document.getElementById('auth-message').textContent = 'Sending your sign-in link...';
      const email = document.getElementById('sign-in-email').value.trim();
      try {
        const result = await supabaseClient.auth.signInWithOtp({
          email: email,
          options: { emailRedirectTo: window.location.origin }
        });
        if (result.error) {
          const isRateLimited = result.error.status === 429 || /rate.?limit|too many requests|over_email_send_rate_limit/i.test(result.error.message || '');
          if (isRateLimited) {
            startSignInCooldown();
          } else {
            button.disabled = false;
            document.getElementById('auth-message').textContent = 'We could not send the link just now. Check the email address and try again shortly.';
          }
          return;
        }
        button.disabled = false;
        document.getElementById('auth-message').textContent = 'Check your email for a sign-in link. Open it on this device to continue.';
      } catch (error) {
        button.disabled = false;
        document.getElementById('auth-message').textContent = 'We could not reach the sign-in service. Please try again shortly.';
      }
    });
    document.getElementById('sign-out').addEventListener('click', async function () {
      const result = await supabaseClient.auth.signOut({ scope: 'local' });
      if (result.error) showToast('Could not sign out: ' + result.error.message);
    });
    supabaseClient.auth.onAuthStateChange(function (event, session) {
      if (event === 'SIGNED_OUT') {
        cloudSession = null;
        notes = [];
        activeNoteId = null;
        document.querySelector('.avatar').textContent = 'M';
        showPublicCommunity();
      } else if (event === 'INITIAL_SESSION' && !session) {
        showPublicCommunity();
      } else if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        loadCloudSession(session).catch(function (error) {
          cloudSession = null;
          showCloudGate('Cloud setup needs attention: ' + error.message + ' Check the database setup in README.md, then reload.');
        });
      }
    });
    supabaseClient.auth.getSession().then(function (result) {
      if (result.error) throw result.error;
      if (result.data.session) return loadCloudSession(result.data.session);
      showPublicCommunity();
      return null;
    }).catch(function (error) {
      cloudSession = null;
      showCloudGate('Could not connect to your account: ' + error.message);
    });
    window.addEventListener('focus', refreshCloudNotes);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refreshCloudNotes();
    });
    window.addEventListener('online', function () {
      if (cloudSession && cloudWritePending) saveCloudRows([], null);
    });
  }

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

  document.querySelectorAll('.format-button').forEach(function (button) {
    button.addEventListener('mousedown', function (event) { event.preventDefault(); });
    button.addEventListener('click', function () {
      editor.focus();
      document.execCommand(button.dataset.command, false, button.dataset.value || null);
      scheduleSave();
    });
  });

  function saveNow() {
    const note = currentNote();
    if (!note) return;
    window.clearTimeout(saveTimer);
    saveTimer = null;
    note.title = titleInput.value;
    note.body = editor.innerHTML;
    note.updatedAt = Date.now();
    saveNotes(note);
    renderList();
    const button = document.getElementById('save-note');
    const label = document.getElementById('save-label');
    button.classList.add('is-saved');
    label.textContent = 'Saved';
    showToast('Note saved');
    window.setTimeout(function () { button.classList.remove('is-saved'); label.textContent = 'Save'; }, 1600);
  }
  document.getElementById('save-note').addEventListener('click', saveNow);

  document.getElementById('pin-note').addEventListener('click', function () {
    const note = currentNote();
    if (!note) return;
    note.pinned = !note.pinned;
    saveNotes(note);
    openNote(note.id);
  });

  document.getElementById('delete-note').addEventListener('click', function () {
    if (!currentNote()) return;
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    const deletedId = activeNoteId;
    notes = notes.filter(function (note) { return note.id !== activeNoteId; });
    if (!notes.length) notes.push({ id: createId(), title: '', body: '', pinned: false, createdAt: Date.now(), updatedAt: Date.now() });
    saveNotes(notes, deletedId);
    openNote(notes[0].id);
    showToast('Note deleted');
  });

  document.getElementById('insert-image').addEventListener('click', function () {
    document.getElementById('image-input').click();
  });

  document.getElementById('image-input').addEventListener('change', function (event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      showToast('Choose a picture smaller than 3 MB.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      editor.focus();
      document.execCommand('insertHTML', false, '<p><img src="' + reader.result + '" alt="' + file.name.replace(/[&"<>]/g, '') + '"></p><p><br></p>');
      scheduleSave();
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  });

  document.getElementById('import-font').addEventListener('click', function () {
    document.getElementById('font-input').click();
  });

  document.getElementById('font-input').addEventListener('change', function (event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast('Choose a font file smaller than 2 MB.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      const fontName = file.name.replace(/\.[^.]+$/, '').replace(/["'\\]/g, '').slice(0, 32) || 'Notebook font';
      const fontData = reader.result;
      const accountFontKey = cloudSession ? FONT_KEY + ':' + cloudSession.user.id : FONT_KEY;
      try {
        localStorage.setItem(accountFontKey, JSON.stringify({ name: fontName, data: fontData }));
        applyImportedFont(fontName, fontData).then(function () {
          if (cloudSession) return saveFontToCloud(fontName, fontData);
        }).then(function () { showToast(fontName + ' is ready to use.'); })
          .catch(function () { showToast('That font could not be loaded.'); });
      } catch (error) {
        showToast('Could not save this font. Try a smaller file.');
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  });

  document.getElementById('about-button').addEventListener('click', function () {
    showToast(cloudSession ? 'Notes and fonts sync to your private account.' : 'Notes and fonts stay in this browser.');
  });

  document.addEventListener('keydown', function (event) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modifier = isMac ? event.metaKey : event.ctrlKey;
    if (modifier && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      document.getElementById('new-note').click();
    } else if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!document.getElementById('notes-view').hidden) saveNow();
    } else if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && document.activeElement !== editor) {
      event.preventDefault();
      searchInput.focus();
    }
  });

  startCloudApp();
}());