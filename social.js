(function () {
  'use strict';

  const client = window.TIDEPOOL_SUPABASE;
  if (!client) return;

  const toast = document.getElementById('toast');
  const feedList = document.getElementById('feed-list');
  const peopleList = document.getElementById('people-list');
  let session = null;
  let profile = null;
  let relationshipRows = [];
  let toastTimer;
  let searchTimer;
  let activeIdentity = 'unset';
  let feedRevision = 0;
  let activeChat = null;
  let chatChannel = null;
  let chatMessageRevision = 0;
  let feedFilter = 'all';

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toast.classList.remove('is-visible'); }, 2800);
  }

  function makeElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function displayName(person) {
    return person.display_name || person.username || 'Tidepool member';
  }

  function initials(person) {
    return displayName(person).trim().charAt(0).toUpperCase() || '?';
  }

  function formattedAge(timestamp) {
    const elapsed = Date.now() - new Date(timestamp).getTime();
    if (elapsed < 60 * 1000) return 'Just now';
    if (elapsed < 60 * 60 * 1000) return Math.floor(elapsed / (60 * 1000)) + 'm ago';
    if (elapsed < 24 * 60 * 60 * 1000) return Math.floor(elapsed / (60 * 60 * 1000)) + 'h ago';
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(timestamp));
  }

  function signedIn() {
    return Boolean(session && profile);
  }

  function openSignIn() {
    document.getElementById('guest-sign-in').click();
  }

  function activateView(view, options) {
    const settings = options || {};
    if (!['feed', 'discover', 'friends', 'chats', 'profile', 'notes'].includes(view)) return;
    if (!session && (view === 'friends' || view === 'chats' || view === 'profile' || view === 'notes')) {
      openSignIn();
      return;
    }
    if (session && !profile && view !== 'profile') view = 'profile';
    document.body.dataset.chatOpen = 'false';

    document.body.dataset.view = view;
    document.querySelectorAll('[data-view-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.viewPanel !== view;
    });
    document.querySelectorAll('.nav-item').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.view === view);
    });
    document.getElementById('breadcrumb-section').textContent = {
      feed: 'Community', discover: 'Community', friends: 'Community', chats: 'Community', profile: 'Community', notes: 'My notebook'
    }[view];
    document.getElementById('breadcrumb-title').textContent = {
      feed: 'Public feed', discover: 'Discover', friends: 'Friends', chats: 'Chats', profile: profile ? '@' + profile.username : 'Set up your profile', notes: 'A little space to think'
    }[view];
    document.getElementById('note-footer-meta').hidden = view !== 'notes';
    document.getElementById('footer-message').textContent = view === 'notes'
      ? 'A little space for the things worth keeping.'
      : 'A little space for the moments worth sharing.';
    if (view === 'feed') renderFeed(feedList);
    if (view === 'discover') searchPeople(document.getElementById('people-search').value.trim());
    if (view === 'friends') loadConnections();
    if (view === 'chats') loadChatThreads();
    if (view === 'profile' && profile) showOwnProfile();
  }

  async function syncProfile() {
    if (!session) return null;
    const result = await client.from('profiles').select('user_id,username,display_name,bio,created_at').eq('user_id', session.user.id).maybeSingle();
    if (result.error) throw result.error;
    profile = result.data;
    document.getElementById('post-form').hidden = !profile;
    document.getElementById('composer-name').textContent = profile ? displayName(profile) : 'Your profile';
    document.getElementById('composer-avatar').textContent = profile ? initials(profile) : '?';
    document.getElementById('profile-hint').textContent = profile
      ? 'Your profile is visible to people who visit Tidepool.'
      : 'Choose a username to finish setting up your public profile.';
    document.getElementById('profile-display-name').value = profile ? profile.display_name : '';
    document.getElementById('profile-username').value = profile ? profile.username : '';
    document.getElementById('profile-bio').value = profile ? profile.bio : '';
    document.getElementById('profile-card-name').textContent = profile ? displayName(profile) : 'Set up your profile';
    document.getElementById('profile-card-username').textContent = profile ? '@' + profile.username : 'Choose a username';
    document.getElementById('profile-card-bio').textContent = profile ? profile.bio : '';
    document.getElementById('profile-avatar').textContent = profile ? initials(profile) : '?';
    return profile;
  }

  async function enterAsGuest() {
    if (activeIdentity === 'guest') return;
    activeIdentity = 'guest';
    session = null;
    profile = null;
    relationshipRows = [];
    activeChat = null;
    if (chatChannel) client.removeChannel(chatChannel);
    chatChannel = null;
    document.body.dataset.chatOpen = 'false';
    document.body.dataset.mode = 'social';
    document.getElementById('guest-notice').hidden = false;
    document.getElementById('post-form').hidden = true;
    document.getElementById('guest-sign-in').hidden = false;
    document.getElementById('sign-out').hidden = true;
    document.getElementById('friend-count').hidden = true;
    document.getElementById('profile-form').hidden = true;
    document.getElementById('profile-hint').textContent = 'Sign in to create your profile.';
    activateView('feed');
    await renderFeed(feedList);
  }

  async function enterAsMember(nextSession) {
    const nextIdentity = nextSession.user.id;
    if (activeIdentity === nextIdentity) return;
    activeIdentity = nextIdentity;
    session = nextSession;
    document.body.dataset.mode = 'social';
    document.getElementById('guest-notice').hidden = true;
    document.getElementById('guest-sign-in').hidden = true;
    document.getElementById('sign-out').hidden = false;
    document.getElementById('profile-form').hidden = false;
    document.getElementById('privacy-label').textContent = 'Private to your account';
    const avatar = document.querySelector('.avatar');
    avatar.textContent = (session.user.email || '?').charAt(0).toUpperCase();
    try {
      const currentProfile = await syncProfile();
      await loadConnections();
      if (currentProfile) {
        activateView('feed');
        await renderFeed(feedList);
      } else {
        activateView('profile');
        document.getElementById('profile-display-name').focus();
      }
    } catch (error) {
      showToast('Could not load your social profile: ' + error.message);
    }
  }

  async function loadConnections() {
    if (!session) return [];
    const result = await client.from('friend_requests')
      .select('id,requester_id,addressee_id,status,created_at')
      .or('requester_id.eq.' + session.user.id + ',addressee_id.eq.' + session.user.id)
      .order('created_at', { ascending: false });
    if (result.error) throw result.error;
    relationshipRows = result.data;
    const incoming = relationshipRows.filter(function (request) { return request.addressee_id === session.user.id && request.status === 'pending'; });
    const outgoing = relationshipRows.filter(function (request) { return request.requester_id === session.user.id && request.status === 'pending'; });
    const accepted = relationshipRows.filter(function (request) { return request.status === 'accepted'; });
    document.getElementById('friend-count').textContent = String(incoming.length || '');
    document.getElementById('friend-count').hidden = incoming.length === 0;
    document.getElementById('incoming-count').textContent = String(incoming.length);
    document.getElementById('sent-count').textContent = String(outgoing.length);
    document.getElementById('accepted-count').textContent = String(accepted.length);
    const memberIds = Array.from(new Set(relationshipRows.flatMap(function (request) {
      return [request.requester_id, request.addressee_id];
    }).filter(function (id) { return id !== session.user.id; })));
    const profilesResult = memberIds.length
      ? await client.from('profiles').select('user_id,username,display_name,bio').in('user_id', memberIds)
      : { data: [], error: null };
    if (profilesResult.error) throw profilesResult.error;
    const byId = new Map(profilesResult.data.map(function (person) { return [person.user_id, person]; }));
    renderRelationshipGroup('incoming-list', incoming, byId, function (request) {
      return { label: 'Accept', action: function () { updateRequest(request, 'accepted'); } };
    }, 'No new requests.');
    renderRelationshipGroup('sent-list', outgoing, byId, function (request) {
      return { label: 'Cancel', action: function () { cancelRequest(request); } };
    }, 'No outgoing requests.');
    renderRelationshipGroup('accepted-list', accepted, byId, function (request, person) {
      return { label: 'Message', action: function () { openChatWith(person); } };
    }, 'Accepted friends appear here.');
    return relationshipRows;
  }

  function peerIdFor(thread) {
    return thread.user_a === session.user.id ? thread.user_b : thread.user_a;
  }

  async function loadChatThreads() {
    const container = document.getElementById('chat-thread-list');
    if (!session || !profile) return;
    const result = await client.from('chat_threads')
      .select('id,user_a,user_b,created_at,updated_at')
      .or('user_a.eq.' + session.user.id + ',user_b.eq.' + session.user.id)
      .order('updated_at', { ascending: false });
    if (result.error) {
      container.replaceChildren(makeElement('p', 'chat-thread-empty', 'Could not load chats: ' + result.error.message));
      return;
    }
    const threads = result.data;
    document.getElementById('chat-count').textContent = String(threads.length || '');
    document.getElementById('chat-count').hidden = threads.length === 0;
    if (!threads.length) {
      container.replaceChildren(makeElement('p', 'chat-thread-empty', 'Your conversations with friends will appear here.'));
      return;
    }
    const threadIds = threads.map(function (thread) { return thread.id; });
    const friendIds = threads.map(peerIdFor);
    const [profilesResult, messagesResult] = await Promise.all([
      client.from('profiles').select('user_id,username,display_name,bio').in('user_id', friendIds),
      client.from('chat_messages').select('thread_id,sender_id,body,created_at')
        .in('thread_id', threadIds).order('created_at', { ascending: false }).limit(500)
    ]);
    if (profilesResult.error || messagesResult.error) {
      container.replaceChildren(makeElement('p', 'chat-thread-empty', 'Could not load conversations.'));
      return;
    }
    const peopleById = new Map(profilesResult.data.map(function (person) { return [person.user_id, person]; }));
    const latestByThread = new Map();
    messagesResult.data.forEach(function (message) {
      if (!latestByThread.has(message.thread_id)) latestByThread.set(message.thread_id, message);
    });
    container.replaceChildren();
    threads.forEach(function (thread) {
      const person = peopleById.get(peerIdFor(thread));
      if (!person) return;
      const latest = latestByThread.get(thread.id);
      const row = makeElement('button', 'chat-thread' + (activeChat && activeChat.thread.id === thread.id ? ' is-active' : ''));
      row.type = 'button';
      row.appendChild(makeElement('span', 'person-avatar', initials(person)));
      const copy = makeElement('span', 'chat-thread-copy');
      copy.append(
        makeElement('strong', '', displayName(person)),
        makeElement('small', '', latest ? (latest.sender_id === session.user.id ? 'You: ' : '') + latest.body : 'Start a conversation')
      );
      row.appendChild(copy);
      if (latest) row.appendChild(makeElement('span', 'chat-thread-time', formattedAge(latest.created_at)));
      row.addEventListener('click', function () { selectChat(thread, person); });
      container.appendChild(row);
    });
  }

  async function openChatWith(person) {
    if (!session || !profile) {
      showToast('Sign in and save your profile to chat.');
      return openSignIn();
    }
    const relationship = relationshipFor(person.user_id);
    if (!relationship || relationship.status !== 'accepted') {
      showToast('Chats are available between accepted friends.');
      return;
    }
    const participants = [session.user.id, person.user_id].sort();
    const lookup = await client.from('chat_threads').select('id,user_a,user_b,created_at,updated_at')
      .eq('user_a', participants[0]).eq('user_b', participants[1]).maybeSingle();
    if (lookup.error) {
      showToast('Could not open chat: ' + lookup.error.message);
      return;
    }
    let thread = lookup.data;
    if (!thread) {
      const created = await client.from('chat_threads').insert({ user_a: participants[0], user_b: participants[1] })
        .select('id,user_a,user_b,created_at,updated_at').single();
      if (created.error) {
        if (created.error.code === '23505') return openChatWith(person);
        showToast('Could not start chat: ' + created.error.message);
        return;
      }
      thread = created.data;
    }
    document.body.dataset.view = 'chats';
    document.querySelectorAll('[data-view-panel]').forEach(function (panel) { panel.hidden = panel.dataset.viewPanel !== 'chats'; });
    document.querySelectorAll('.nav-item').forEach(function (button) { button.classList.toggle('is-active', button.dataset.view === 'chats'); });
    document.getElementById('breadcrumb-section').textContent = 'Community';
    document.getElementById('breadcrumb-title').textContent = 'Chats';
    document.getElementById('note-footer-meta').hidden = true;
    document.getElementById('footer-message').textContent = 'A little space for a private conversation.';
    await loadChatThreads();
    await selectChat(thread, person);
  }

  async function selectChat(thread, person) {
    activeChat = { thread: thread, person: person };
    document.body.dataset.chatOpen = 'true';
    document.getElementById('chat-empty').hidden = true;
    document.getElementById('chat-active').hidden = false;
    document.getElementById('chat-avatar').textContent = initials(person);
    document.getElementById('chat-person-name').textContent = displayName(person);
    document.getElementById('chat-person-handle').textContent = '@' + person.username;
    await loadChatMessages(thread.id);
    await loadChatThreads();
    if (chatChannel) await client.removeChannel(chatChannel);
    chatChannel = client.channel('chat-' + thread.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: 'thread_id=eq.' + thread.id
      }, function () {
        if (activeChat && activeChat.thread.id === thread.id) {
          loadChatMessages(thread.id);
          loadChatThreads();
        }
      })
      .subscribe(function (status) {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') showToast('Live chat is reconnecting.');
      });
  }

  async function loadChatMessages(threadId) {
    const revision = ++chatMessageRevision;
    const container = document.getElementById('chat-messages');
    const result = await client.from('chat_messages').select('id,thread_id,sender_id,body,created_at')
      .eq('thread_id', threadId).order('created_at', { ascending: true }).limit(500);
    if (revision !== chatMessageRevision) return;
    if (result.error) {
      container.replaceChildren(makeElement('p', 'chat-no-messages', 'Could not load messages: ' + result.error.message));
      return;
    }
    container.replaceChildren();
    if (!result.data.length) container.appendChild(makeElement('p', 'chat-no-messages', 'No messages yet. Say hello.'));
    result.data.forEach(function (message) {
      const ownMessage = message.sender_id === session.user.id;
      const wrapper = makeElement('article', 'chat-message' + (ownMessage ? ' is-own' : ''));
      wrapper.appendChild(makeElement('p', 'chat-bubble', message.body));
      wrapper.appendChild(makeElement('time', 'chat-time', new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(message.created_at))));
      container.appendChild(wrapper);
    });
    container.scrollTop = container.scrollHeight;
  }

  async function sendChatMessage(event) {
    event.preventDefault();
    if (!session || !profile || !activeChat) return;
    const input = document.getElementById('chat-input');
    const body = input.value.trim();
    if (!body) return;
    const sendButton = document.getElementById('chat-send');
    sendButton.disabled = true;
    const result = await client.from('chat_messages').insert({
      thread_id: activeChat.thread.id,
      sender_id: session.user.id,
      body: body
    });
    sendButton.disabled = false;
    if (result.error) {
      showToast('Message not sent: ' + result.error.message);
      return;
    }
    input.value = '';
    await loadChatMessages(activeChat.thread.id);
    await loadChatThreads();
  }

  function renderRelationshipGroup(elementId, requests, profilesById, actionFor, emptyMessage) {
    const container = document.getElementById(elementId);
    container.replaceChildren();
    if (!requests.length) {
      container.appendChild(makeElement('p', 'feed-empty', emptyMessage));
      return;
    }
    requests.forEach(function (request) {
      const personId = request.requester_id === session.user.id ? request.addressee_id : request.requester_id;
      const person = profilesById.get(personId);
      if (!person) return;
      const descriptor = actionFor(request, person);
      container.appendChild(makePersonRow(person, descriptor.label, descriptor.action, descriptor.disabled));
    });
  }

  function relationshipFor(personId) {
    return relationshipRows.find(function (request) {
      return (request.requester_id === session.user.id && request.addressee_id === personId)
        || (request.addressee_id === session.user.id && request.requester_id === personId);
    });
  }

  function makePersonRow(person, actionLabel, action, disabled) {
    const row = makeElement('article', 'person-row');
    row.appendChild(makeElement('span', 'person-avatar', initials(person)));
    const copy = makeElement('div', 'person-copy');
    const nameButton = makeElement('button', '', displayName(person));
    nameButton.type = 'button';
    nameButton.addEventListener('click', function () { openProfile(person.user_id); });
    copy.append(nameButton, makeElement('small', '', '@' + person.username + (person.bio ? ' · ' + person.bio : '')));
    row.appendChild(copy);
    if (actionLabel) {
      const actionButton = makeElement('button', 'person-action', actionLabel);
      actionButton.type = 'button';
      actionButton.disabled = Boolean(disabled);
      if (action) actionButton.addEventListener('click', action);
      row.appendChild(actionButton);
    }
    return row;
  }

  async function searchPeople(query) {
    if (!peopleList) return;
    peopleList.replaceChildren();
    const safeQuery = query.toLowerCase().replace(/^@/, '').trim();
    if (safeQuery.length === 1) {
      peopleList.appendChild(makeElement('p', 'feed-empty', 'Type at least two characters to search.'));
      return;
    }
    let request = client.from('profiles').select('user_id,username,display_name,bio,created_at').order('created_at', { ascending: false }).limit(30);
    if (safeQuery) request = request.or('username.ilike.%' + safeQuery + '%,display_name.ilike.%' + safeQuery + '%');
    const result = await request;
    if (result.error) {
      showToast('Could not search profiles: ' + result.error.message);
      return;
    }
    const people = result.data.filter(function (person) { return !session || person.user_id !== session.user.id; });
    if (!people.length) {
      peopleList.appendChild(makeElement('p', 'feed-empty', 'No profiles found. Try another name.'));
      return;
    }
    people.forEach(function (person) {
      const relation = session && relationshipFor(person.user_id);
      let label = session ? 'Add friend' : 'Sign in';
      let action = session ? function () { sendRequest(person); } : openSignIn;
      let disabled = false;
      if (relation && relation.status === 'accepted') {
        label = 'Message';
        action = function () { openChatWith(person); };
      } else if (relation && relation.status === 'pending' && relation.requester_id === session.user.id) {
        label = 'Requested';
        action = function () { cancelRequest(relation); };
      } else if (relation && relation.status === 'pending') {
        label = 'Accept';
        action = function () { updateRequest(relation, 'accepted'); };
      }
      peopleList.appendChild(makePersonRow(person, label, action, disabled));
    });
  }

  async function sendRequest(person) {
    if (!session || !profile) {
      showToast('Save your profile before sending friend requests.');
      activateView('profile');
      return;
    }
    const relation = relationshipFor(person.user_id);
    if (relation && relation.status === 'pending' && relation.addressee_id === session.user.id) {
      await updateRequest(relation, 'accepted');
      return;
    }
    if (relation) return;
    const result = await client.from('friend_requests').insert({
      requester_id: session.user.id,
      addressee_id: person.user_id,
      status: 'pending'
    });
    if (result.error) {
      showToast('Could not send the request: ' + result.error.message);
      return;
    }
    showToast('Friend request sent to ' + displayName(person) + '.');
    await loadConnections();
    await searchPeople(document.getElementById('people-search').value.trim());
  }

  async function updateRequest(request, status) {
    const result = await client.from('friend_requests').update({ status: status, updated_at: new Date().toISOString() })
      .eq('id', request.id)
      .eq('addressee_id', session.user.id);
    if (result.error) {
      showToast('Could not update the request: ' + result.error.message);
      return;
    }
    showToast(status === 'accepted' ? 'You are now friends.' : 'Request declined.');
    await loadConnections();
    if (document.body.dataset.view === 'feed') await renderFeed(feedList);
  }

  async function cancelRequest(request) {
    const result = await client.from('friend_requests').delete().eq('id', request.id).eq('requester_id', session.user.id);
    if (result.error) {
      showToast('Could not cancel the request: ' + result.error.message);
      return;
    }
    await loadConnections();
    await searchPeople(document.getElementById('people-search').value.trim());
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!session) return;
    const saveButton = event.currentTarget.querySelector('button[type="submit"]');
    saveButton.disabled = true;
    const values = {
      user_id: session.user.id,
      display_name: document.getElementById('profile-display-name').value.trim(),
      username: document.getElementById('profile-username').value.trim().toLowerCase(),
      bio: document.getElementById('profile-bio').value.trim(),
      updated_at: new Date().toISOString()
    };
    const result = await client.from('profiles').upsert(values, { onConflict: 'user_id' })
      .select('user_id,username,display_name,bio,created_at').single();
    saveButton.disabled = false;
    if (result.error) {
      showToast(result.error.code === '23505' ? 'That username is already taken.' : 'Could not save profile: ' + result.error.message);
      return;
    }
    profile = result.data;
    await syncProfile();
    showToast('Profile saved.');
    activateView('feed');
  }

  async function openProfile(userId) {
    if (userId === session?.user.id) {
      activateView('profile');
      await showOwnProfile();
      return;
    }
    const result = await client.from('profiles').select('user_id,username,display_name,bio,created_at').eq('user_id', userId).maybeSingle();
    if (result.error || !result.data) {
      showToast('This profile is not available.');
      return;
    }
    document.body.dataset.view = 'profile';
    document.querySelectorAll('[data-view-panel]').forEach(function (panel) { panel.hidden = panel.dataset.viewPanel !== 'profile'; });
    document.querySelectorAll('.nav-item').forEach(function (button) { button.classList.toggle('is-active', button.dataset.view === 'profile'); });
    document.getElementById('breadcrumb-section').textContent = 'Community';
    document.getElementById('breadcrumb-title').textContent = '@' + result.data.username;
    document.getElementById('profile-form').hidden = true;
    document.getElementById('profile-hint').textContent = 'Public profile';
    document.getElementById('profile-card-name').textContent = displayName(result.data);
    document.getElementById('profile-card-username').textContent = '@' + result.data.username;
    document.getElementById('profile-card-bio').textContent = result.data.bio;
    document.getElementById('profile-avatar').textContent = initials(result.data);
    await renderFeed(document.getElementById('my-posts'), userId);
  }

  async function showOwnProfile() {
    if (!profile) {
      document.getElementById('profile-form').hidden = false;
      document.getElementById('profile-hint').textContent = 'Choose a username to finish setting up your public profile.';
      document.getElementById('my-posts').replaceChildren();
      return;
    }
    document.getElementById('profile-form').hidden = false;
    document.getElementById('profile-hint').textContent = 'Your profile is visible to people who visit Tidepool.';
    document.getElementById('profile-card-name').textContent = displayName(profile);
    document.getElementById('profile-card-username').textContent = '@' + profile.username;
    document.getElementById('profile-card-bio').textContent = profile.bio;
    document.getElementById('profile-avatar').textContent = initials(profile);
    await renderFeed(document.getElementById('my-posts'), profile.user_id);
  }

  function extensionFor(file) {
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
    return extensions[file.type];
  }

  async function publishPost(event) {
    event.preventDefault();
    if (!session || !profile) {
      showToast('Create your profile before sharing a photo.');
      activateView('profile');
      return;
    }
    const photoFile = document.getElementById('post-photo').files[0];
    const captionText = document.getElementById('post-caption').value.trim();
    if (!photoFile && !captionText) return;
    if (photoFile && (!extensionFor(photoFile) || photoFile.size > 5 * 1024 * 1024)) {
      showToast('Choose a JPG, PNG, WebP, or GIF smaller than 5 MB.');
      return;
    }
    const button = document.getElementById('publish-post');
    button.disabled = true;
    button.textContent = 'Posting...';
    const postId = crypto.randomUUID();
    const photoPath = photoFile ? session.user.id + '/' + postId + '.' + extensionFor(photoFile) : null;
    const upload = photoFile ? await client.storage.from('social-photos').upload(photoPath, photoFile, {
      contentType: photoFile.type,
      upsert: false
    }) : {};
    if (upload.error) {
      button.disabled = false;
      button.textContent = 'Post';
      showToast('Could not upload photo: ' + upload.error.message);
      return;
    }
    const inserted = await client.from('posts').insert({
      id: postId,
      author_id: session.user.id,
      caption: captionText,
      photo_path: photoPath,
      visibility: document.getElementById('post-visibility').value
    });
    button.disabled = false;
    button.textContent = 'Post';
    if (inserted.error) {
      if (photoPath) await client.storage.from('social-photos').remove([photoPath]);
      showToast('Could not publish post: ' + inserted.error.message);
      return;
    }
    document.getElementById('post-form').reset();
    updateComposer();
    showToast('Posted.');
    activateView('feed');
  }

  async function renderFeed(container, authorId) {
    if (!container) return;
    const revision = ++feedRevision;
    const pill = document.querySelector('.new-posts-pill');
    if (pill && container === feedList) pill.hidden = true;
    container.replaceChildren(makeElement('p', 'feed-empty', 'Finding the latest moments...'));
    let query = client.from('posts').select('id,author_id,caption,photo_path,visibility,created_at')
      .order('created_at', { ascending: false }).limit(30);
    if (authorId) query = query.eq('author_id', authorId);
    const postsResult = await query;
    if (revision !== feedRevision) return;
    if (postsResult.error) {
      container.replaceChildren(makeElement('p', 'feed-empty', 'The feed is not ready yet. Run the social schema in Supabase, then reload.'));
      return;
    }
    let posts = postsResult.data;
    if (container === feedList && feedFilter === 'friends' && session) {
      const circle = new Set([session.user.id]);
      relationshipRows.forEach(function (row) { if (row.status === 'accepted') { circle.add(row.requester_id); circle.add(row.addressee_id); } });
      posts = posts.filter(function (post) { return circle.has(post.author_id); });
    }
    if (!posts.length) {
      container.replaceChildren(makeElement('p', 'feed-empty', authorId ? 'No posts here yet.' : (feedFilter === 'friends' ? 'Nothing from friends yet. Find people in Discover.' : 'The tide is quiet. Be the first to post.')));
      return;
    }
    const postIds = posts.map(function (post) { return post.id; });
    const authorIds = Array.from(new Set(posts.map(function (post) { return post.author_id; })));
    const [profilesResult, likesResult, commentsResult] = await Promise.all([
      client.from('profiles').select('user_id,username,display_name,bio').in('user_id', authorIds),
      client.from('post_likes').select('post_id,user_id').in('post_id', postIds),
      client.from('post_comments').select('id,post_id,author_id,body,created_at').in('post_id', postIds).order('created_at', { ascending: true })
    ]);
    if (revision !== feedRevision) return;
    if (profilesResult.error || likesResult.error || commentsResult.error) {
      container.replaceChildren(makeElement('p', 'feed-empty', 'Could not load this feed. Check the Supabase social schema and try again.'));
      return;
    }
    const photoPaths = posts.map(function (post) { return post.photo_path; }).filter(Boolean);
    const photosResult = photoPaths.length ? await client.storage.from('social-photos').createSignedUrls(photoPaths, 3600) : { data: [] };
    if (revision !== feedRevision) return;
    const peopleById = new Map(profilesResult.data.map(function (person) { return [person.user_id, person]; }));
    const missingPeople = Array.from(new Set(commentsResult.data.map(function (comment) { return comment.author_id; }))).filter(function (id) { return !peopleById.has(id); });
    if (missingPeople.length) {
      const extra = await client.from('profiles').select('user_id,username,display_name,bio').in('user_id', missingPeople);
      (extra.data || []).forEach(function (person) { peopleById.set(person.user_id, person); });
      if (revision !== feedRevision) return;
    }
    const likesByPost = new Map();
    likesResult.data.forEach(function (like) {
      if (!likesByPost.has(like.post_id)) likesByPost.set(like.post_id, []);
      likesByPost.get(like.post_id).push(like);
    });
    const commentsByPost = new Map();
    commentsResult.data.forEach(function (comment) {
      if (!commentsByPost.has(comment.post_id)) commentsByPost.set(comment.post_id, []);
      commentsByPost.get(comment.post_id).push(comment);
    });
    const photoUrls = new Map((photosResult.data || []).map(function (photo) { return [photo.path, photo.signedUrl]; }));
    container.replaceChildren();
    posts.forEach(function (post) {
      const author = peopleById.get(post.author_id) || { username: 'member', display_name: 'Tidepool member' };
      container.appendChild(renderPost(post, author, photoUrls.get(post.photo_path), likesByPost.get(post.id) || [], commentsByPost.get(post.id) || [], peopleById));
    });
  }

  function renderPost(post, author, photoUrl, likes, comments, people) {
    const directory = people || new Map();
    const article = makeElement('article', 'feed-post');
    const header = makeElement('header', 'post-head');
    header.appendChild(makeElement('span', 'person-avatar', initials(author)));
    const authorCopy = makeElement('div', 'post-author');
    const authorButton = makeElement('button', '', displayName(author));
    authorButton.type = 'button';
    authorButton.addEventListener('click', function () { openProfile(post.author_id); });
    authorCopy.append(authorButton, makeElement('small', '', '@' + author.username + ' · ' + formattedAge(post.created_at)));
    header.appendChild(authorCopy);
    header.appendChild(makeElement('span', 'post-visibility', post.visibility === 'friends' ? 'FRIENDS' : 'PUBLIC'));
    article.appendChild(header);
    if (post.caption) article.appendChild(makeElement('p', 'post-caption', post.caption));
    if (photoUrl) {
      const image = makeElement('img', 'post-photo');
      image.src = photoUrl;
      image.alt = 'Photo shared by ' + displayName(author);
      image.loading = 'lazy';
      article.appendChild(image);
    }

    const actions = makeElement('div', 'post-actions');
    let liked = Boolean(session && likes.some(function (like) { return like.user_id === session.user.id; }));
    let likeCount = likes.length;
    const likeButton = makeElement('button', 'post-action');
    likeButton.type = 'button';
    function paintLike() {
      likeButton.classList.toggle('is-liked', liked);
      likeButton.textContent = (liked ? '♥' : '♡') + ' ' + likeCount;
      likeButton.setAttribute('aria-pressed', String(liked));
      likeButton.setAttribute('aria-label', (liked ? 'Unlike' : 'Like') + ' post, ' + likeCount + ' likes');
    }
    paintLike();
    likeButton.addEventListener('click', async function () {
      if (!session) return openSignIn();
      if (!profile) {
        showToast('Save your profile before liking posts.');
        return activateView('profile');
      }
      const wasLiked = liked;
      liked = !liked;
      likeCount += liked ? 1 : -1;
      paintLike();
      const result = wasLiked
        ? await client.from('post_likes').delete().eq('post_id', post.id).eq('user_id', session.user.id)
        : await client.from('post_likes').insert({ post_id: post.id, user_id: session.user.id });
      if (result.error) {
        liked = wasLiked;
        likeCount += liked ? 1 : -1;
        paintLike();
        showToast('Could not update like: ' + result.error.message);
      }
    });
    let replyCount = comments.length;
    const replyButton = makeElement('button', 'post-action');
    replyButton.type = 'button';
    function paintReplies() {
      replyButton.textContent = '○ ' + replyCount;
      replyButton.setAttribute('aria-label', 'Replies, ' + replyCount);
    }
    paintReplies();
    replyButton.addEventListener('click', function () { article.classList.toggle('is-open'); });
    const shareButton = makeElement('button', 'post-action', '↗ Share');
    shareButton.type = 'button';
    shareButton.addEventListener('click', function () {
      const url = window.location.href.split('#')[0];
      const text = (post.caption || 'A post on Tidepool Notes').slice(0, 140);
      if (navigator.share) {
        navigator.share({ title: 'Tidepool Notes', text: text, url: url }).catch(function () { });
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text + ' ' + url).then(function () { showToast('Copied to clipboard.'); }, function () { showToast('Could not copy.'); });
      }
    });
    actions.append(replyButton, likeButton, shareButton);
    if (session && post.author_id === session.user.id) {
      const deleteButton = makeElement('button', 'post-action post-delete', 'Delete');
      deleteButton.type = 'button';
      deleteButton.addEventListener('click', function () { deletePost(post); });
      actions.appendChild(deleteButton);
    }
    article.appendChild(actions);

    const commentsArea = makeElement('div', 'post-comments');
    const thread = makeElement('div', 'comment-thread');
    function addToThread(authorId, body) {
      const own = session && authorId === session.user.id;
      const person = directory.get(authorId);
      const element = makeElement('p', 'post-comment');
      element.append(makeElement('strong', '', own ? 'You' : (person ? '@' + person.username : '@member')), document.createTextNode(body));
      thread.appendChild(element);
      return element;
    }
    comments.slice(-5).forEach(function (comment) { addToThread(comment.author_id, comment.body); });
    commentsArea.appendChild(thread);
    if (session && profile) {
      const commentForm = makeElement('form', 'comment-form');
      const input = makeElement('input');
      input.type = 'text';
      input.maxLength = 280;
      input.placeholder = 'Post your reply';
      input.setAttribute('aria-label', 'Reply to this post');
      input.required = true;
      const submit = makeElement('button', '', 'Reply');
      submit.type = 'submit';
      commentForm.append(input, submit);
      commentForm.addEventListener('submit', function (event) {
        event.preventDefault();
        const body = input.value.trim();
        if (!body) return;
        input.value = '';
        const element = addToThread(session.user.id, body);
        replyCount += 1;
        paintReplies();
        client.from('post_comments').insert({ post_id: post.id, author_id: session.user.id, body: body }).then(function (result) {
          if (!result.error) return;
          element.remove();
          replyCount -= 1;
          paintReplies();
          input.value = body;
          showToast('Could not send reply: ' + result.error.message);
        });
      });
      commentsArea.appendChild(commentForm);
    } else if (!session) {
      const commentButton = makeElement('button', 'post-action', 'Sign in to reply');
      commentButton.type = 'button';
      commentButton.addEventListener('click', openSignIn);
      commentsArea.appendChild(commentButton);
    }
    article.appendChild(commentsArea);
    return article;
  }

  async function deletePost(post) {
    if (!window.confirm('Delete this photo post?')) return;
    const removed = post.photo_path ? await client.storage.from('social-photos').remove([post.photo_path]) : {};
    if (removed.error) {
      showToast('Could not remove photo: ' + removed.error.message);
      return;
    }
    const result = await client.from('posts').delete().eq('id', post.id).eq('author_id', session.user.id);
    if (result.error) {
      showToast('Could not delete post: ' + result.error.message);
      return;
    }
    await renderFeed(feedList);
    if (!document.getElementById('profile-view').hidden) await renderFeed(document.getElementById('my-posts'), profile.user_id);
  }

  document.querySelectorAll('.nav-item').forEach(function (button) {
    button.addEventListener('click', function () { activateView(button.dataset.view); });
  });
  document.querySelector('.avatar').addEventListener('click', function () { activateView('profile'); });
  document.getElementById('compose-jump').addEventListener('click', function () {
    if (!session) return openSignIn();
    if (!profile) return activateView('profile');
    const box = document.getElementById('post-form');
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('post-caption').focus({ preventScroll: true });
  });
  document.getElementById('choose-post-photo').addEventListener('click', function () {
    document.getElementById('post-photo').click();
  });
  document.getElementById('post-photo').addEventListener('change', function (event) {
    updateComposer();
  });
  function updateComposer() {
    const caption = document.getElementById('post-caption');
    const file = document.getElementById('post-photo').files[0];
    const left = 280 - caption.value.length;
    const counter = document.getElementById('char-count');
    counter.textContent = String(left);
    counter.classList.toggle('is-low', left < 20);
    document.getElementById('selected-photo').textContent = file ? file.name : 'Add a photo (optional)';
    document.getElementById('publish-post').disabled = !(caption.value.trim() || file);
    caption.style.height = 'auto';
    caption.style.height = Math.min(caption.scrollHeight, 220) + 'px';
  }
  document.getElementById('post-caption').addEventListener('input', updateComposer);
  document.getElementById('post-caption').addEventListener('keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!document.getElementById('publish-post').disabled) document.getElementById('post-form').requestSubmit();
    }
  });
  document.querySelectorAll('.feed-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      if (tab.dataset.feed === 'friends' && !session) return openSignIn();
      feedFilter = tab.dataset.feed;
      document.querySelectorAll('.feed-tab').forEach(function (other) {
        other.classList.toggle('is-active', other === tab);
        other.setAttribute('aria-selected', String(other === tab));
      });
      renderFeed(feedList);
    });
  });
  (function watchNewPosts() {
    const pill = makeElement('button', 'new-posts-pill', '↑ New posts');
    pill.type = 'button';
    pill.hidden = true;
    feedList.before(pill);
    pill.addEventListener('click', function () { renderFeed(feedList); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    client.channel('feed-posts').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, function (payload) {
      if (session && payload.new && payload.new.author_id === session.user.id) return;
      if (document.body.dataset.view === 'feed') pill.hidden = false;
    }).subscribe();
  }());
  document.getElementById('post-form').addEventListener('submit', publishPost);
  document.getElementById('profile-form').addEventListener('submit', saveProfile);
  document.getElementById('chat-form').addEventListener('submit', sendChatMessage);
  document.getElementById('chat-back').addEventListener('click', function () {
    document.body.dataset.chatOpen = 'false';
    document.getElementById('chat-empty').hidden = false;
    document.getElementById('chat-active').hidden = true;
    loadChatThreads();
  });
  document.getElementById('people-search').addEventListener('input', function (event) {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function () { searchPeople(event.target.value); }, 220);
  });
  window.addEventListener('focus', function () {
    if (document.body.dataset.view === 'feed' && document.body.dataset.mode === 'social') renderFeed(feedList);
  });
  window.addEventListener('online', function () {
    if (document.body.dataset.view === 'feed') renderFeed(feedList);
  });
  client.auth.onAuthStateChange(function (event, nextSession) {
    if (nextSession) enterAsMember(nextSession);
    else if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') enterAsGuest();
  });
  client.auth.getSession().then(function (result) {
    if (result.data.session) return enterAsMember(result.data.session);
    return enterAsGuest();
  }).catch(function () { enterAsGuest(); });
}());