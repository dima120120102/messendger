// Инициализация Supabase
const supabaseUrl = 'https://jppczsckjihbwpxklazy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwcGN6c2NramloYndweGtsYXp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM5MjA4MjMsImV4cCI6MjA1OTQ5NjgyM30.2PWGaFa5ymAjru-TgyknhCb91_S-1EQpLAk8y9DGggI';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

// Cloudinary API-ключи
const CLOUDINARY_CLOUD_NAME = 'ds9ghsha0';
const CLOUDINARY_API_KEY = '213912739345749';
const CLOUDINARY_UPLOAD_PRESET = 'messenger_upload';

// Переменные для текущего пользователя и состояния чата
let currentUser = null;
let selectedChat = null;
let selectedChatType = null;
let allUsers = [];
let allGroups = [];
let selectedMemberId = null;
let currentSubscription = null;
let mediaRecorder = null;
let audioChunks = [];
let audioAnalyser = null;
let audioContext = null;
let audioBlob = null;

// Дебаунс для загрузки контактов
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Загрузка контактов и групп
const loadContactsDebounced = debounce(async () => {
    const contactList = document.getElementById('contactList');
    contactList.innerHTML = '';

    if (allUsers.length === 0) {
        const { data: users, error: usersError } = await supabase
            .from('profiles')
            .select('*')
            .neq('id', currentUser.id);

        if (usersError) {
            console.error('Ошибка загрузки пользователей:', usersError);
            return;
        }
        allUsers = users;
    }

    if (allGroups.length === 0) {
        const { data: groups, error: groupsError } = await supabase
            .from('groups')
            .select('*')
            .in('id', (await supabase
                .from('group_members')
                .select('group_id')
                .eq('user_id', currentUser.id)).data.map(m => m.group_id));

        if (groupsError) {
            console.error('Ошибка загрузки групп:', groupsError);
            return;
        }
        allGroups = groups;
    }

    const searchQuery = document.getElementById('searchInput').value.trim().toLowerCase();

    if (!searchQuery) {
        allUsers.forEach(user => {
            const div = document.createElement('div');
            div.classList.add('contact');
            div.setAttribute('data-id', user.id);
            div.setAttribute('data-type', 'user');
            div.innerHTML = `
                <div class="contact-avatar" style="${user.profile_picture ? 'background: none;' : ''}">
                    ${user.profile_picture ? `<img src="${user.profile_picture}" alt="${user.username}">` : user.username[0]}
                </div>
                <span class="contact-name">${user.username}${user.unique_username ? ` (${user.unique_username})` : ''}</span>
            `;
            div.addEventListener('click', () => selectChat(user.id, 'user', user.username));
            contactList.appendChild(div);
        });

        allGroups.forEach(group => {
            const div = document.createElement('div');
            div.classList.add('contact');
            div.setAttribute('data-id', group.id);
            div.setAttribute('data-type', 'group');
            div.innerHTML = `
                <div class="contact-avatar" style="${group.avatar_url ? 'background: none;' : ''}">
                    ${group.avatar_url ? `<img src="${group.avatar_url}" alt="${group.name}">` : '👥'}
                </div>
                <span class="contact-name">${group.name}${group.unique_username ? ` (${group.unique_username})` : ''}</span>
            `;
            div.addEventListener('click', () => selectChat(group.id, 'group', group.name));
            contactList.appendChild(div);
        });
    } else {
        allUsers
            .filter(user => 
                user.username.toLowerCase().includes(searchQuery) || 
                (user.unique_username && user.unique_username.toLowerCase().includes(searchQuery))
            )
            .forEach(user => {
                const div = document.createElement('div');
                div.classList.add('contact');
                div.setAttribute('data-id', user.id);
                div.setAttribute('data-type', 'user');
                div.innerHTML = `
                    <div class="contact-avatar" style="${user.profile_picture ? 'background: none;' : ''}">
                        ${user.profile_picture ? `<img src="${user.profile_picture}" alt="${user.username}">` : user.username[0]}
                    </div>
                    <span class="contact-name">${user.username}${user.unique_username ? ` (${user.unique_username})` : ''}</span>
                `;
                div.addEventListener('click', () => selectChat(user.id, 'user', user.username));
                contactList.appendChild(div);
            });

        const { data: allAvailableGroups, error: groupsError } = await supabase
            .from('groups')
            .select('*');

        if (groupsError) {
            console.error('Ошибка загрузки всех групп:', groupsError);
            return;
        }

        allAvailableGroups
            .filter(group => 
                group.name.toLowerCase().includes(searchQuery) || 
                (group.unique_username && group.unique_username.toLowerCase().includes(searchQuery))
            )
            .forEach(group => {
                const isMember = allGroups.some(g => g.id === group.id);
                const div = document.createElement('div');
                div.classList.add('contact');
                div.setAttribute('data-id', group.id);
                div.setAttribute('data-type', 'group');
                div.innerHTML = `
                    <div class="contact-avatar" style="${group.avatar_url ? 'background: none;' : ''}">
                        ${group.avatar_url ? `<img src="${group.avatar_url}" alt="${group.name}">` : '👥'}
                    </div>
                    <span class="contact-name">${group.name}${group.unique_username ? ` (${group.unique_username})` : ''}</span>
                    ${!isMember ? '<button class="request-join-btn">Присоединиться</button>' : ''}
                `;
                if (!isMember) {
                    const joinBtn = div.querySelector('.request-join-btn');
                    joinBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const { error } = await supabase
                            .from('group_join_requests')
                            .insert({ group_id: group.id, user_id: currentUser.id, status: 'pending' });
                        if (error) {
                            if (error.code === '23505') {
                                alert('Вы уже отправили заявку на вступление!');
                            } else {
                                console.error('Ошибка отправки заявки:', error);
                                alert('Ошибка: ' + error.message);
                            }
                        } else {
                            await supabase
                                .from('messages')
                                .insert({
                                    group_id: group.id,
                                    sender_id: null,
                                    receiver_id: null,
                                    text: `${currentUser.profile.username} подал заявку на вступление`,
                                    is_system: true
                                });
                            alert('Заявка на вступление отправлена!');
                        }
                    });
                }
                div.addEventListener('click', () => {
                    if (isMember) selectChat(group.id, 'group', group.name);
                });
                contactList.appendChild(div);
            });
    }
}, 300);

// Функция загрузки файлов в Cloudinary
async function uploadToCloudinary(file, folder) {
    if (!file) throw new Error('Файл не выбран');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folder);
    formData.append('public_id', `${Date.now()}_${file.name || 'audio'}`);
    formData.append('api_key', CLOUDINARY_API_KEY);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

    const resourceType = file.type.startsWith('video/') ? 'video' : 
                        file.type.startsWith('audio/') ? 'video' : 'image';
    const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`, {
        method: 'POST',
        body: formData,
    });

    const result = await response.json();
    if (result.error) throw new Error(result.error.message);
    return result.secure_url;
}

// Форматирование времени для сообщений
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// Форматирование даты рождения
function formatDate(date) {
    if (!date) return 'Не указано';
    const d = new Date(date);
    return d.toLocaleDateString('ru-RU');
}

// Проверка авторизации пользователя
async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        if (!user.email_confirmed_at) {
            document.getElementById('awaitConfirmationModal').style.display = 'flex';
            return;
        }

        const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (error) {
            console.error("Ошибка загрузки профиля:", error);
            showAuthModal();
        } else {
            currentUser = { ...user, profile };
            document.getElementById('authModal').style.display = 'none';
            document.getElementById('registerModal').style.display = 'none';
            document.getElementById('awaitConfirmationModal').style.display = 'none';
            loadContactsDebounced();
        }
    } else {
        showAuthModal();
    }
}

// Показ модального окна входа
function showAuthModal() {
    document.getElementById('authModal').style.display = 'flex';
    document.getElementById('registerModal').style.display = 'none';
    document.getElementById('awaitConfirmationModal').style.display = 'none';
}

// Показ модального окна регистрации
function showRegisterModal() {
    document.getElementById('authModal').style.display = 'none';
    document.getElementById('registerModal').style.display = 'flex';
    document.getElementById('awaitConfirmationModal').style.display = 'none';
}

// Переключение между входом и регистрацией
document.getElementById('toggleAuth').addEventListener('click', showRegisterModal);
document.getElementById('toggleLogin').addEventListener('click', showAuthModal);

// Вход
document.getElementById('authButton').addEventListener('click', async () => {
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('passwordInput').value.trim();

    if (!email || !password) {
        alert("Заполните все поля!");
        return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        console.error("Ошибка входа:", error);
        alert("Ошибка входа: " + error.message);
    } else {
        checkUser();
    }
});

// Регистрация
document.getElementById('registerButton').addEventListener('click', async () => {
    const username = document.getElementById('usernameInput').value.trim();
    const email = document.getElementById('registerEmailInput').value.trim();
    const password = document.getElementById('registerPasswordInput').value.trim();

    if (!username || !email || !password) {
        alert("Заполните все поля!");
        return;
    }

    const { data: { user }, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin }
    });

    if (authError) {
        console.error("Ошибка регистрации:", authError);
        alert("Ошибка регистрации: " + authError.message);
        return;
    }

    const { data: existingProfile, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
        console.error("Ошибка проверки профиля:", fetchError);
        alert("Ошибка проверки профиля: " + fetchError.message);
        await supabase.auth.signOut();
        return;
    }

    if (existingProfile) {
        const { error: deleteError } = await supabase
            .from('profiles')
            .delete()
            .eq('id', user.id);
        if (deleteError) {
            console.error("Ошибка удаления старого профиля:", deleteError);
            alert("Ошибка удаления старого профиля: " + deleteError.message);
            await supabase.auth.signOut();
            return;
        }
    }

    const { error: profileError } = await supabase
        .from('profiles')
        .insert({ id: user.id, username, unique_username: null });

    if (profileError) {
        console.error("Ошибка создания профиля:", profileError.message);
        alert("Ошибка создания профиля: " + profileError.message);
        await supabase.auth.signOut();
        return;
    }

    document.getElementById('registerModal').style.display = 'none';
    document.getElementById('awaitConfirmationModal').style.display = 'flex';
});

// Отмена ожидания подтверждения
document.getElementById('cancelAwaitButton').addEventListener('click', async () => {
    await supabase.auth.signOut();
    document.getElementById('awaitConfirmationModal').style.display = 'none';
    showAuthModal();
});

// Показ выпадающего меню
document.getElementById('menuButton').addEventListener('click', () => {
    const dropdown = document.getElementById('dropdownMenu');
    dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
});

// Показ профиля текущего пользователя
document.getElementById('viewMyProfileButton').addEventListener('click', () => {
    showProfile(currentUser.profile, true);
    document.getElementById('dropdownMenu').style.display = 'none';
});

// Показ профиля собеседника
document.getElementById('viewContactProfileButton').addEventListener('click', async () => {
    if (selectedChatType === 'user') {
        const contact = allUsers.find(user => user.id === selectedChat);
        if (contact) {
            showProfile(contact, false);
        } else {
            const { data: profile, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', selectedChat)
                .single();
            if (error) {
                console.error('Ошибка загрузки профиля собеседника:', error);
                alert('Ошибка: ' + error.message);
            } else {
                showProfile(profile, false);
            }
        }
    }
});

// Показ профиля
function showProfile(profile, isOwnProfile) {
    const modal = document.getElementById('viewProfileModal');
    const username = document.getElementById('viewProfileUsername');
    const uniqueUsername = document.getElementById('viewProfileUniqueUsername');
    const picture = document.getElementById('viewProfilePicture');
    const bio = document.getElementById('viewProfileBio');
    const birthdate = document.getElementById('viewProfileBirthdate');
    const editButton = document.getElementById('editProfileButton');

    if (!profile) {
        alert('Профиль не найден!');
        return;
    }

    username.textContent = profile.username || 'Не указано';
    uniqueUsername.textContent = profile.unique_username || 'Не указано';
    picture.src = profile.profile_picture || '';
    picture.style.display = profile.profile_picture ? 'block' : 'none';
    bio.textContent = profile.bio || 'Не указано';
    birthdate.textContent = formatDate(profile.birthdate);

    editButton.style.display = isOwnProfile ? 'block' : 'none';

    modal.style.display = 'flex';
    modal.style.zIndex = '2000';
}

// Закрытие модального окна профиля
document.querySelector('#viewProfileModal .modal-close-btn').addEventListener('click', () => {
    document.getElementById('viewProfileModal').style.display = 'none';
});

// Редактирование профиля
document.getElementById('editProfileButton').addEventListener('click', () => {
    document.getElementById('viewProfileModal').style.display = 'none';
    const modal = document.getElementById('editProfileModal');
    const usernameInput = document.getElementById('editUsernameInput');
    const uniqueUsernameInput = document.getElementById('uniqueUsernameInput');
    const picturePreview = document.getElementById('editProfilePicturePreview');
    const bioInput = document.getElementById('bioInput');
    const birthdateInput = document.getElementById('birthdateInput');

    usernameInput.value = currentUser.profile.username || '';
    uniqueUsernameInput.value = currentUser.profile.unique_username || '';
    picturePreview.src = currentUser.profile.profile_picture || '';
    picturePreview.style.display = currentUser.profile.profile_picture ? 'block' : 'none';
    bioInput.value = currentUser.profile.bio || '';
    birthdateInput.value = currentUser.profile.birthdate || '';

    modal.style.display = 'flex';
});

// Предпросмотр фото профиля
document.getElementById('profilePictureInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const preview = document.getElementById('editProfilePicturePreview');
        preview.src = URL.createObjectURL(file);
        preview.style.display = 'block';
    }
});

// Сохранение профиля
document.getElementById('saveProfileButton').addEventListener('click', async () => {
    const fileInput = document.getElementById('profilePictureInput');
    const usernameInput = document.getElementById('editUsernameInput').value.trim();
    const uniqueUsernameInput = document.getElementById('uniqueUsernameInput').value.trim();
    const bio = document.getElementById('bioInput').value.trim();
    const birthdate = document.getElementById('birthdateInput').value;
    let profilePicture = currentUser.profile.profile_picture;

    if (!usernameInput) {
        alert('Имя пользователя обязательно!');
        return;
    }

    let uniqueUsername = uniqueUsernameInput;
    if (uniqueUsername && !uniqueUsername.startsWith('@')) uniqueUsername = `@${uniqueUsername}`;
    if (uniqueUsername) {
        const { data: existingUser, error } = await supabase
            .from('profiles')
            .select('id')
            .eq('unique_username', uniqueUsername)
            .neq('id', currentUser.id)
            .single();

        if (existingUser) {
            alert('Этот уникальный ник уже занят!');
            return;
        }
        if (error && error.code !== 'PGRST116') {
            console.error('Ошибка проверки уникальности ника:', error);
            alert('Ошибка проверки уникальности ника: ' + error.message);
            return;
        }
    }

    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        if (file.size > 5 * 1024 * 1024) {
            alert("Файл слишком большой! Максимальный размер — 5 МБ.");
            return;
        }
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
        if (!allowedTypes.includes(file.type)) {
            alert("Пожалуйста, выберите изображение (JPEG, PNG или GIF)!");
            return;
        }

        try {
            profilePicture = await uploadToCloudinary(file, `profile-pictures/${currentUser.id}`);
        } catch (error) {
            console.error("Ошибка загрузки фото:", error);
            alert("Ошибка загрузки фото: " + error.message);
            return;
        }
    }

    const { error } = await supabase
        .from('profiles')
        .update({
            username: usernameInput,
            unique_username: uniqueUsername || null,
            bio: bio || null,
            birthdate: birthdate || null,
            profile_picture: profilePicture
        })
        .eq('id', currentUser.id);

    if (error) {
        console.error("Ошибка обновления профиля:", error);
        alert("Ошибка обновления профиля: " + error.message);
    } else {
        currentUser.profile = {
            ...currentUser.profile,
            username: usernameInput,
            unique_username: uniqueUsername || null,
            bio: bio || null,
            birthdate: birthdate || null,
            profile_picture: profilePicture
        };
        document.getElementById('editProfileModal').style.display = 'none';
        allUsers = [];
        loadContactsDebounced();
        showProfile(currentUser.profile, true);
        alert('Профиль успешно обновлен!');
    }
});

document.getElementById('cancelEditProfileButton').addEventListener('click', () => {
    document.getElementById('editProfileModal').style.display = 'none';
});

// Создание группы
document.getElementById('createGroupButtonMenu').addEventListener('click', () => {
    document.getElementById('dropdownMenu').style.display = 'none';
    const modal = document.getElementById('createGroupModal');
    const membersList = document.getElementById('groupMembersList');
    const avatarPreview = document.getElementById('groupAvatarPreview');
    membersList.innerHTML = '';
    avatarPreview.style.display = 'none';
    document.getElementById('groupNameInput').value = '';
    document.getElementById('groupUniqueUsernameInput').value = '';
    document.getElementById('groupDescriptionInput').value = '';
    document.getElementById('groupAvatarInput').value = '';

    allUsers.forEach(user => {
        const div = document.createElement('div');
        div.classList.add('group-member-item');
        div.innerHTML = `
            <label>
                <input type="checkbox" class="group-member-checkbox" data-user-id="${user.id}">
                <div class="member-avatar" style="${user.profile_picture ? 'background: none;' : ''}">
                    ${user.profile_picture ? `<img src="${user.profile_picture}" alt="${user.username}">` : user.username[0]}
                </div>
                <span>${user.username}${user.unique_username ? ` (${user.unique_username})` : ''}</span>
            </label>
        `;
        membersList.appendChild(div);
    });

    modal.style.display = 'flex';
});

// Предпросмотр аватарки группы (создание)
document.getElementById('groupAvatarInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const preview = document.getElementById('groupAvatarPreview');
        preview.src = URL.createObjectURL(file);
        preview.style.display = 'block';
    }
});

document.getElementById('createGroupButton').addEventListener('click', async () => {
    const groupName = document.getElementById('groupNameInput').value.trim();
    const groupUniqueUsernameInput = document.getElementById('groupUniqueUsernameInput').value.trim();
    const groupDescription = document.getElementById('groupDescriptionInput').value.trim();
    const selectedMembers = Array.from(document.querySelectorAll('.group-member-checkbox:checked'))
        .map(cb => cb.getAttribute('data-user-id'));
    const avatarInput = document.getElementById('groupAvatarInput');
    let avatarUrl = null;

    if (!groupName) {
        alert('Введите название группы!');
        return;
    }
    if (selectedMembers.length < 2) {
        alert('Выберите минимум 2 участников для группы!');
        return;
    }

    let groupUniqueUsername = groupUniqueUsernameInput;
    if (groupUniqueUsername && !groupUniqueUsername.startsWith('@')) groupUniqueUsername = `@${groupUniqueUsername}`;
    if (groupUniqueUsername) {
        const { data: existingGroup, error } = await supabase
            .from('groups')
            .select('id')
            .eq('unique_username', groupUniqueUsername)
            .single();

        if (existingGroup) {
            alert('Этот уникальный ник уже занят!');
            return;
        }
        if (error && error.code !== 'PGRST116') {
            console.error('Ошибка проверки уникальности ника:', error);
            alert('Ошибка проверки уникальности ника: ' + error.message);
            return;
        }
    }

    document.getElementById('createGroupModal').style.display = 'none';
    document.getElementById('loadingModal').style.display = 'flex';

    if (avatarInput.files.length > 0) {
        const file = avatarInput.files[0];
        if (file.size > 5 * 1024 * 1024) {
            alert("Файл слишком большой! Максимальный размер — 5 МБ.");
            document.getElementById('loadingModal').style.display = 'none';
            return;
        }
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
        if (!allowedTypes.includes(file.type)) {
            alert("Пожалуйста, выберите изображение (JPEG, PNG или GIF)!");
            document.getElementById('loadingModal').style.display = 'none';
            return;
        }

        try {
            avatarUrl = await uploadToCloudinary(file, `group-avatars/${Date.now()}`);
        } catch (error) {
            console.error("Ошибка загрузки аватарки:", error);
            alert("Ошибка загрузки аватарки: " + error.message);
            document.getElementById('loadingModal').style.display = 'none';
            return;
        }
    }

    selectedMembers.push(currentUser.id);

    const { data: group, error: groupError } = await supabase
        .from('groups')
        .insert({
            name: groupName,
            unique_username: groupUniqueUsername || null,
            description: groupDescription || null,
            avatar_url: avatarUrl,
            owner_id: currentUser.id
        })
        .select()
        .single();

    if (groupError) {
        console.error('Ошибка создания группы:', groupError);
        alert('Ошибка создания группы: ' + groupError.message);
        document.getElementById('loadingModal').style.display = 'none';
        return;
    }

    const groupMembers = selectedMembers.map(userId => ({
        group_id: group.id,
        user_id: userId,
        is_admin: userId === currentUser.id
    }));

    const { error: membersError } = await supabase
        .from('group_members')
        .insert(groupMembers);

    if (membersError) {
        console.error('Ошибка добавления участников:', membersError);
        alert('Ошибка добавления участников: ' + membersError.message);
        document.getElementById('loadingModal').style.display = 'none';
        return;
    }

    const { error: messageError } = await supabase
        .from('messages')
        .insert({
            group_id: group.id,
            sender_id: null,
            receiver_id: null,
            text: `Группа "${groupName}" была создана`,
            is_system: true
        });

    if (messageError) {
        console.error('Ошибка отправки системного сообщения:', messageError);
    }

    document.getElementById('loadingModal').style.display = 'none';
    allGroups = [];
    loadContactsDebounced();
});

document.getElementById('cancelGroupButton').addEventListener('click', () => {
    document.getElementById('createGroupModal').style.display = 'none';
});

// Проверка статуса администратора
async function isUserAdmin(groupId, userId) {
    const { data, error } = await supabase
        .from('group_members')
        .select('is_admin')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .single();

    if (error) {
        console.error('Ошибка проверки статуса админа:', error);
        return false;
    }
    return data.is_admin || false;
}

// Редактирование группы
document.getElementById('editGroupButton').addEventListener('click', async () => {
    if (selectedChatType !== 'group') return;

    const group = allGroups.find(g => g.id === selectedChat);
    if (!group) return;

    const isAdmin = await isUserAdmin(selectedChat, currentUser.id);
    const isOwner = group.owner_id === currentUser.id;

    const modal = document.getElementById('editGroupModal');
    const avatarPreview = document.getElementById('editGroupAvatarPreview');
    const nameInput = document.getElementById('editGroupNameInput');
    const uniqueUsernameInput = document.getElementById('editGroupUniqueUsernameInput');
    const descriptionInput = document.getElementById('editGroupDescriptionInput');
    const membersList = document.getElementById('editGroupMembersList');
    const ownerDetails = document.getElementById('groupOwnerDetails');
    const deleteButton = document.getElementById('deleteGroupButton');
    const leaveButton = document.getElementById('leaveGroupButton');
    const addMembersButton = document.getElementById('addMembersButton');

    nameInput.value = group.name;
    uniqueUsernameInput.value = group.unique_username || '';
    descriptionInput.value = group.description || '';
    avatarPreview.src = group.avatar_url || '';
    avatarPreview.style.display = group.avatar_url ? 'block' : 'none';

    deleteButton.style.display = isOwner ? 'block' : 'none';
    leaveButton.style.display = !isOwner ? 'block' : 'none';
    addMembersButton.style.display = (isOwner || isAdmin) ? 'block' : 'none';
    nameInput.disabled = !(isOwner || isAdmin);
    uniqueUsernameInput.disabled = !(isOwner || isAdmin);
    descriptionInput.disabled = !(isOwner || isAdmin);

    const { data: ownerProfile, error: ownerError } = await supabase
        .from('profiles')
        .select('username, unique_username, profile_picture')
        .eq('id', group.owner_id)
        .single();

    if (ownerError) {
        ownerDetails.innerHTML = '<span>Не удалось загрузить информацию о создателе</span>';
    } else {
        ownerDetails.innerHTML = `
            <div class="owner-avatar" style="${ownerProfile.profile_picture ? 'background: none;' : ''}">
                ${ownerProfile.profile_picture ? `<img src="${ownerProfile.profile_picture}" alt="${ownerProfile.username}">` : ownerProfile.username[0]}
            </div>
            <span>${ownerProfile.username}${ownerProfile.unique_username ? ` (${ownerProfile.unique_username})` : ''}</span>
        `;
    }

    const { data: currentMembers, error: membersError } = await supabase
        .from('group_members')
        .select('user_id, is_admin, profiles!inner(username, profile_picture, unique_username)')
        .eq('group_id', group.id);

    if (membersError) {
        console.error('Ошибка загрузки участников:', membersError);
        return;
    }

    membersList.innerHTML = '';
    currentMembers.forEach(member => {
        const div = document.createElement('div');
        div.classList.add('group-member-item');
        div.setAttribute('data-user-id', member.user_id);
        div.innerHTML = `
            <div class="member-avatar" style="${member.profiles.profile_picture ? 'background: none;' : ''}">
                ${member.profiles.profile_picture ? `<img src="${member.profiles.profile_picture}" alt="${member.profiles.username}">` : member.profiles.username[0]}
            </div>
            <span>${member.profiles.username}${member.profiles.unique_username ? ` (${member.profiles.unique_username})` : ''}${member.is_admin ? ' (Админ)' : ''}</span>
        `;
        div.addEventListener('click', (e) => {
            e.stopPropagation();
            if (member.user_id === currentUser.id) return;

            selectedMemberId = member.user_id;
            const actionsModal = document.getElementById('memberActionsModal');
            const toggleAdminBtn = document.getElementById('toggleAdminButton');
            const removeMemberBtn = document.getElementById('removeMemberButton');
            const messageMemberBtn = document.getElementById('messageMemberButton');
            const viewMemberProfileBtn = document.getElementById('viewMemberProfileButton');

            if (isOwner || isAdmin) {
                toggleAdminBtn.style.display = 'block';
                toggleAdminBtn.textContent = member.is_admin ? 'Снять админа' : 'Сделать админом';
                removeMemberBtn.style.display = 'block';
            } else {
                toggleAdminBtn.style.display = 'none';
                removeMemberBtn.style.display = 'none';
            }

            messageMemberBtn.style.display = 'block';
            viewMemberProfileBtn.style.display = 'block';

            actionsModal.style.display = 'block';
            const rect = div.getBoundingClientRect();
            actionsModal.style.left = `${rect.right + 10}px`;
            actionsModal.style.top = `${rect.top}px`;
        });
        membersList.appendChild(div);
    });

    const { data: requests, error: reqError } = await supabase
        .from('group_join_requests')
        .select('user_id, profiles!inner(username, profile_picture)')
        .eq('group_id', group.id)
        .eq('status', 'pending');

    if (reqError) {
        console.error('Ошибка загрузки заявок:', reqError);
        return;
    }

    const requestsContainer = document.getElementById('groupRequests');
    requestsContainer.innerHTML = '';
    if (requests.length > 0 && (isOwner || isAdmin)) {
        requestsContainer.style.display = 'block';
        const requestsDiv = document.createElement('div');
        requestsDiv.classList.add('group-requests');
        requestsDiv.innerHTML = '<h3>Заявки на вступление</h3><div class="requests-list"></div>';
        const requestsList = requestsDiv.querySelector('.requests-list');

        requests.forEach(req => {
            const div = document.createElement('div');
            div.classList.add('request-item');
            div.innerHTML = `
                <div class="request-avatar" style="${req.profiles.profile_picture ? 'background: none;' : ''}">
                    ${req.profiles.profile_picture ? `<img src="${req.profiles.profile_picture}" alt="${req.profiles.username}">` : req.profiles.username[0]}
                </div>
                <span class="request-username">${req.profiles.username}</span>
                <div class="request-actions">
                    <button class="approve-btn" data-user-id="${req.user_id}" title="Одобрить">✔</button>
                    <button class="reject-btn" data-user-id="${req.user_id}" title="Отклонить">✖</button>
                </div>
            `;
            requestsList.appendChild(div);
        });
        requestsContainer.appendChild(requestsDiv);

        requestsDiv.querySelectorAll('.approve-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const userId = btn.getAttribute('data-user-id');
                const { data: userProfile } = await supabase
                    .from('profiles')
                    .select('username')
                    .eq('id', userId)
                    .single();

                await supabase
                    .from('group_join_requests')
                    .update({ status: 'approved' })
                    .eq('group_id', group.id)
                    .eq('user_id', userId);

                await supabase
                    .from('group_members')
                    .insert({ group_id: group.id, user_id: userId, is_admin: false });

                await supabase
                    .from('messages')
                    .insert({
                        group_id: group.id,
                        sender_id: null,
                        receiver_id: null,
                        text: `Заявка ${userProfile.username} была принята`,
                        is_system: true
                    });

                alert('Заявка одобрена!');
                document.getElementById('editGroupButton').click();
            });
        });

        requestsDiv.querySelectorAll('.reject-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const userId = btn.getAttribute('data-user-id');
                const { data: userProfile } = await supabase
                    .from('profiles')
                    .select('username')
                    .eq('id', userId)
                    .single();

                await supabase
                    .from('group_join_requests')
                    .update({ status: 'rejected' })
                    .eq('group_id', group.id)
                    .eq('user_id', userId);

                await supabase
                    .from('messages')
                    .insert({
                        group_id: group.id,
                        sender_id: null,
                        receiver_id: null,
                        text: `Заявка ${userProfile.username} была отклонена`,
                        is_system: true
                    });

                alert('Заявка отклонена!');
                document.getElementById('editGroupButton').click();
            });
        });
    } else {
        requestsContainer.style.display = 'none';
    }

    modal.style.display = 'flex';
});

// Закрытие модального окна редактирования группы
document.getElementById('closeEditGroupModal').addEventListener('click', () => {
    document.getElementById('editGroupModal').style.display = 'none';
});

// Добавление участников
document.getElementById('addMembersButton').addEventListener('click', async () => {
    const group = allGroups.find(g => g.id === selectedChat);
    const isAdmin = await isUserAdmin(selectedChat, currentUser.id);
    if (!(group.owner_id === currentUser.id || isAdmin)) {
        alert('Только создатель или администратор может добавлять участников!');
        return;
    }

    const modal = document.createElement('div');
    modal.classList.add('modal');
    modal.innerHTML = `
        <div class="modal-content group-modal">
            <button class="modal-close-btn" id="closeAddMembersModal">✖</button>
            <h2>Добавить участников</h2>
            <div class="group-members-container">
                <h3>Выберите пользователей</h3>
                <div id="addMembersList" class="group-members-list"></div>
            </div>
            <div class="modal-buttons">
                <button id="saveNewMembersButton">Добавить</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const addMembersList = modal.querySelector('#addMembersList');
    const currentMemberIds = (await supabase
        .from('group_members')
        .select('user_id')
        .eq('group_id', group.id)).data.map(m => m.user_id);

    allUsers.filter(user => !currentMemberIds.includes(user.id)).forEach(user => {
        const div = document.createElement('div');
        div.classList.add('group-member-item');
        div.innerHTML = `
            <label>
                <input type="checkbox" class="group-member-checkbox" data-user-id="${user.id}">
                <div class="member-avatar" style="${user.profile_picture ? 'background: none;' : ''}">
                    ${user.profile_picture ? `<img src="${user.profile_picture}" alt="${user.username}">` : user.username[0]}
                </div>
                <span>${user.username}${user.unique_username ? ` (${user.unique_username})` : ''}</span>
            </label>
        `;
        addMembersList.appendChild(div);
    });

    modal.querySelector('#closeAddMembersModal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    modal.querySelector('#saveNewMembersButton').addEventListener('click', async () => {
        const selectedNewMembers = Array.from(modal.querySelectorAll('.group-member-checkbox:checked'))
            .map(cb => cb.getAttribute('data-user-id'));

        if (selectedNewMembers.length === 0) {
            alert('Выберите хотя бы одного участника!');
            return;
        }

        const newGroupMembers = selectedNewMembers.map(userId => ({
            group_id: group.id,
            user_id: userId,
            is_admin: false
        }));

        const { error } = await supabase
            .from('group_members')
            .insert(newGroupMembers);

        if (error) {
            console.error('Ошибка добавления участников:', error);
            alert('Ошибка: ' + error.message);
        } else {
            const usernames = await Promise.all(selectedNewMembers.map(async userId => {
                const { data } = await supabase
                    .from('profiles')
                    .select('username')
                    .eq('id', userId)
                    .single();
                return data.username;
            }));

            await supabase
                .from('messages')
                .insert({
                    group_id: group.id,
                    sender_id: null,
                    receiver_id: null,
                    text: `${usernames.join(', ')} были добавлены в группу`,
                    is_system: true
                });

            alert('Участники успешно добавлены!');
            document.body.removeChild(modal);
            document.getElementById('editGroupButton').click();
        }
    });
});

// Предпросмотр аватарки группы (редактирование)
document.getElementById('editGroupAvatarInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const preview = document.getElementById('editGroupAvatarPreview');
        preview.src = URL.createObjectURL(file);
        preview.style.display = 'block';
    }
});

document.getElementById('saveGroupButton').addEventListener('click', async () => {
    const group = allGroups.find(g => g.id === selectedChat);
    const isAdmin = await isUserAdmin(selectedChat, currentUser.id);
    if (!(group.owner_id === currentUser.id || isAdmin)) {
        alert('Только создатель или администратор может изменять настройки группы!');
        return;
    }

    const groupName = document.getElementById('editGroupNameInput').value.trim();
    const groupUniqueUsernameInput = document.getElementById('editGroupUniqueUsernameInput').value.trim();
    const groupDescription = document.getElementById('editGroupDescriptionInput').value.trim();
    const avatarInput = document.getElementById('editGroupAvatarInput');
    let avatarUrl = group.avatar_url;

    if (!groupName) {
        alert('Введите название группы!');
        return;
    }

    let groupUniqueUsername = groupUniqueUsernameInput;
    if (groupUniqueUsername && !groupUniqueUsername.startsWith('@')) groupUniqueUsername = `@${groupUniqueUsername}`;
    if (groupUniqueUsername) {
        const { data: existingGroup, error } = await supabase
            .from('groups')
            .select('id')
            .eq('unique_username', groupUniqueUsername)
            .neq('id', selectedChat)
            .single();

        if (existingGroup) {
            alert('Этот уникальный ник уже занят!');
            return;
        }
        if (error && error.code !== 'PGRST116') {
            console.error('Ошибка проверки уникальности ника:', error);
            alert('Ошибка проверки уникальности ника: ' + error.message);
            return;
        }
    }

    if (avatarInput.files.length > 0) {
        const file = avatarInput.files[0];
        if (file.size > 5 * 1024 * 1024) {
            alert("Файл слишком большой! Максимальный размер — 5 МБ.");
            return;
        }
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
        if (!allowedTypes.includes(file.type)) {
            alert("Пожалуйста, выберите изображение (JPEG, PNG или GIF)!");
            return;
        }

        try {
            avatarUrl = await uploadToCloudinary(file, `group-avatars/${selectedChat}`);
        } catch (error) {
            console.error("Ошибка загрузки аватарки:", error);
            alert("Ошибка загрузки аватарки: " + error.message);
            return;
        }
    }

    const { error: updateError } = await supabase
        .from('groups')
        .update({
            name: groupName,
            unique_username: groupUniqueUsername || null,
            description: groupDescription || null,
            avatar_url: avatarUrl
        })
        .eq('id', selectedChat);

    if (updateError) {
        console.error('Ошибка обновления группы:', updateError);
        alert('Ошибка обновления группы: ' + updateError.message);
        return;
    }

    document.getElementById('editGroupModal').style.display = 'none';
    allGroups = [];
    loadContactsDebounced();
    if (selectedChatType === 'group') {
        document.getElementById('chatHeader').querySelector('span').textContent = groupName;
    }
});

// Удаление группы
document.getElementById('deleteGroupButton').addEventListener('click', () => {
    const group = allGroups.find(g => g.id === selectedChat);
    if (group.owner_id !== currentUser.id) {
        alert('Только создатель может удалить группу!');
        return;
    }
    document.getElementById('editGroupModal').style.display = 'none';
    const confirmModal = document.getElementById('deleteGroupConfirmModal');
    confirmModal.style.display = 'flex';
    document.getElementById('deleteGroupConfirmCheckbox').checked = false;
    document.getElementById('confirmDeleteGroupButton').disabled = true;
});

document.getElementById('deleteGroupConfirmCheckbox').addEventListener('change', (e) => {
    document.getElementById('confirmDeleteGroupButton').disabled = !e.target.checked;
});

document.getElementById('confirmDeleteGroupButton').addEventListener('click', async () => {
    const groupId = selectedChat;

    await supabase.from('group_members').delete().eq('group_id', groupId);
    await supabase.from('group_join_requests').delete().eq('group_id', groupId);
    await supabase.from('messages').delete().eq('group_id', groupId);

    const { error } = await supabase
        .from('groups')
        .delete()
        .eq('id', groupId)
        .eq('owner_id', currentUser.id);

    if (error) {
        console.error('Ошибка удаления группы:', error);
        alert('Ошибка удаления группы: ' + error.message);
        return;
    }

    document.getElementById('deleteGroupConfirmModal').style.display = 'none';
    selectedChat = null;
    selectedChatType = null;
    document.getElementById('chat').innerHTML = '';
    document.getElementById('chatHeader').querySelector('span').textContent = 'Выберите собеседника';
    document.getElementById('editGroupButton').style.display = 'none';
    allGroups = [];
    loadContactsDebounced();
});

document.getElementById('cancelDeleteGroupButton').addEventListener('click', () => {
    document.getElementById('deleteGroupConfirmModal').style.display = 'none';
});

// Выход из группы
document.getElementById('leaveGroupButton').addEventListener('click', () => {
    document.getElementById('editGroupModal').style.display = 'none';
    const confirmModal = document.getElementById('leaveGroupConfirmModal');
    confirmModal.style.display = 'flex';
    document.getElementById('leaveGroupConfirmCheckbox').checked = false;
    document.getElementById('confirmLeaveGroupButton').disabled = true;
});

document.getElementById('leaveGroupConfirmCheckbox').addEventListener('change', (e) => {
    document.getElementById('confirmLeaveGroupButton').disabled = !e.target.checked;
});

document.getElementById('confirmLeaveGroupButton').addEventListener('click', async () => {
    const groupId = selectedChat;

    const { error } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', groupId)
        .eq('user_id', currentUser.id);

    if (error) {
        console.error('Ошибка выхода из группы:', error);
        alert('Ошибка выхода из группы: ' + error.message);
        return;
    }

    await supabase
        .from('messages')
        .insert({
            group_id: groupId,
            sender_id: null,
            receiver_id: null,
            text: `${currentUser.profile.username} вышел из группы`,
            is_system: true
        });

    document.getElementById('leaveGroupConfirmModal').style.display = 'none';
    selectedChat = null;
    selectedChatType = null;
    document.getElementById('chat').innerHTML = '';
    document.getElementById('chatHeader').querySelector('span').textContent = 'Выберите собеседника';
    document.getElementById('editGroupButton').style.display = 'none';
    allGroups = [];
    loadContactsDebounced();
});

document.getElementById('cancelLeaveGroupButton').addEventListener('click', () => {
    document.getElementById('leaveGroupConfirmModal').style.display = 'none';
});

// Обработка действий с участником группы
document.getElementById('toggleAdminButton').addEventListener('click', async () => {
    const group = allGroups.find(g => g.id === selectedChat);
    const isAdmin = await isUserAdmin(selectedChat, currentUser.id);
    if (!(group.owner_id === currentUser.id || isAdmin)) {
        alert('Только создатель или администратор может изменять статус админа!');
        document.getElementById('memberActionsModal').style.display = 'none';
        return;
    }

    if (selectedMemberId === group.owner_id) {
        alert('Нельзя изменить статус админа у создателя группы!');
        document.getElementById('memberActionsModal').style.display = 'none';
        return;
    }

    const { data: member, error: fetchError } = await supabase
        .from('group_members')
        .select('is_admin, profiles!inner(username)')
        .eq('group_id', selectedChat)
        .eq('user_id', selectedMemberId)
        .single();

    if (fetchError) {
        console.error('Ошибка получения данных участника:', fetchError);
        alert('Ошибка: ' + fetchError.message);
        return;
    }

    const newAdminStatus = !member.is_admin;
    const { error: updateError } = await supabase
        .from('group_members')
        .update({ is_admin: newAdminStatus })
        .eq('group_id', selectedChat)
        .eq('user_id', selectedMemberId);

    if (updateError) {
        console.error('Ошибка изменения статуса админа:', updateError);
        alert('Ошибка: ' + updateError.message);
    } else {
        const actionText = newAdminStatus ? 'назначен администратором' : 'снят с роли администратора';
        await supabase
            .from('messages')
            .insert({
                group_id: selectedChat,
                sender_id: null,
                receiver_id: null,
                text: `Пользователь ${member.profiles.username} ${actionText} пользователем ${currentUser.profile.username}`,
                is_system: true
            });

        alert(`Участник ${newAdminStatus ? 'назначен админом' : 'снят с админа'}!`);
        document.getElementById('memberActionsModal').style.display = 'none';
        document.getElementById('editGroupButton').click();
    }
});

// Удаление участника из группы
document.getElementById('removeMemberButton').addEventListener('click', async () => {
    const group = allGroups.find(g => g.id === selectedChat);
    const isAdmin = await isUserAdmin(selectedChat, currentUser.id);
    if (!(group.owner_id === currentUser.id || isAdmin)) {
        alert('Только создатель или администратор может удалять участников!');
        document.getElementById('memberActionsModal').style.display = 'none';
        return;
    }

    if (selectedMemberId === group.owner_id) {
        alert('Нельзя удалить создателя группы!');
        document.getElementById('memberActionsModal').style.display = 'none';
        return;
    }

    const { data: member, error: fetchError } = await supabase
        .from('group_members')
        .select('profiles!inner(username)')
        .eq('group_id', selectedChat)
        .eq('user_id', selectedMemberId)
        .single();

    if (fetchError) {
        console.error('Ошибка получения данных участника:', fetchError);
        alert('Ошибка: ' + fetchError.message);
        return;
    }

    const { error: deleteError } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', selectedChat)
        .eq('user_id', selectedMemberId);

    if (deleteError) {
        console.error('Ошибка удаления участника:', deleteError);
        alert('Ошибка: ' + deleteError.message);
    } else {
        await supabase
            .from('messages')
            .insert({
                group_id: selectedChat,
                sender_id: null,
                receiver_id: null,
                text: `Пользователь ${member.profiles.username} был удален из группы пользователем ${currentUser.profile.username}`,
                is_system: true
            });

        alert('Участник удален из группы!');
        document.getElementById('memberActionsModal').style.display = 'none';
        document.getElementById('editGroupButton').click();
    }
});

// Написать в ЛС
document.getElementById('messageMemberButton').addEventListener('click', async () => {
    if (!selectedMemberId) {
        alert('Пользователь не выбран!');
        return;
    }

    const { data: memberProfile, error } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', selectedMemberId)
        .single();

    if (error) {
        console.error('Ошибка загрузки профиля участника:', error);
        alert('Ошибка: ' + error.message);
        return;
    }

    document.getElementById('memberActionsModal').style.display = 'none';
    document.getElementById('editGroupModal').style.display = 'none';
    await selectChat(selectedMemberId, 'user', memberProfile.username);
});

// Посмотреть профиль
document.getElementById('viewMemberProfileButton').addEventListener('click', async () => {
    if (!selectedMemberId) {
        alert('Пользователь не выбран!');
        return;
    }

    const { data: memberProfile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', selectedMemberId)
        .single();

    if (error) {
        console.error('Ошибка загрузки профиля участника:', error);
        alert('Ошибка: ' + error.message);
        return;
    }

    document.getElementById('memberActionsModal').style.display = 'none';
    showProfile(memberProfile, false);
});

// Закрытие модального окна действий при клике вне его
document.addEventListener('click', (e) => {
    const actionsModal = document.getElementById('memberActionsModal');
    if (actionsModal.style.display === 'block' && !actionsModal.contains(e.target) && !e.target.closest('.group-member-item')) {
        actionsModal.style.display = 'none';
    }
});

// Удаление профиля
document.getElementById('deleteProfileButton').addEventListener('click', () => {
    document.getElementById('dropdownMenu').style.display = 'none';
    const confirmModal = document.getElementById('deleteConfirmModal');
    confirmModal.style.display = 'flex';
    document.getElementById('deleteConfirmCheckbox').checked = false;
    document.getElementById('confirmDeleteButton').disabled = true;
});

document.getElementById('deleteConfirmCheckbox').addEventListener('change', (e) => {
    document.getElementById('confirmDeleteButton').disabled = !e.target.checked;
});

document.getElementById('confirmDeleteButton').addEventListener('click', async () => {
    const { error: messagesError } = await supabase
        .from('messages')
        .delete()
        .eq('sender_id', currentUser.id);

    if (messagesError) {
        console.error('Ошибка удаления сообщений:', messagesError);
        alert('Ошибка удаления сообщений: ' + messagesError.message);
        return;
    }

    const { error: groupMembersError } = await supabase
        .from('group_members')
        .delete()
        .eq('user_id', currentUser.id);

    if (groupMembersError) {
        console.error('Ошибка удаления членства в группах:', groupMembersError);
        alert('Ошибка удаления членства в группах: ' + groupMembersError.message);
        return;
    }

    const { error: groupsError } = await supabase
        .from('groups')
        .delete()
        .eq('owner_id', currentUser.id);

    if (groupsError) {
        console.error('Ошибка удаления групп:', groupsError);
        alert('Ошибка удаления групп: ' + groupsError.message);
        return;
    }

    const { error: profileError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', currentUser.id);

    if (profileError) {
        console.error('Ошибка удаления профиля:', profileError);
        alert('Ошибка удаления профиля: ' + profileError.message);
        return;
    }

    const { error: authError } = await supabase.auth.signOut();
    if (authError) {
        console.error('Ошибка выхода:', authError);
        alert('Ошибка выхода: ' + authError.message);
    }

    document.getElementById('deleteConfirmModal').style.display = 'none';
    showAuthModal();
});

document.getElementById('cancelDeleteButton').addEventListener('click', () => {
    document.getElementById('deleteConfirmModal').style.display = 'none';
});

// Выход из аккаунта
document.getElementById('logoutButton').addEventListener('click', async () => {
    await supabase.auth.signOut();
    document.getElementById('dropdownMenu').style.display = 'none';
    selectedChat = null;
    selectedChatType = null;
    document.getElementById('chat').innerHTML = '';
    document.getElementById('chatHeader').querySelector('span').textContent = 'Выберите собеседника';
    showAuthModal();
});

// Поиск контактов
document.getElementById('searchInput').addEventListener('input', (e) => {
    const clearBtn = document.getElementById('clearSearch');
    clearBtn.style.display = e.target.value ? 'block' : 'none';
    loadContactsDebounced();
});

document.getElementById('clearSearch').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearch').style.display = 'none';
    loadContactsDebounced();
});

// Выбор чата
async function selectChat(id, type, name) {
    if (currentSubscription) {
        await supabase.removeChannel(currentSubscription);
        console.log(`Предыдущая подписка на канал messages:${selectedChatType}:${selectedChat} удалена`);
        currentSubscription = null;
    }

    selectedChat = id;
    selectedChatType = type;

    document.querySelectorAll('.contact').forEach(contact => contact.classList.remove('active'));
    const selectedContact = document.querySelector(`.contact[data-id="${id}"][data-type="${type}"]`);
    if (selectedContact) selectedContact.classList.add('active');

    const header = document.getElementById('chatHeader').querySelector('span');
    header.textContent = name;

    document.getElementById('viewContactProfileButton').style.display = type === 'user' ? 'block' : 'none';
    document.getElementById('editGroupButton').style.display = type === 'group' ? 'block' : 'none';

    document.getElementById('chat').innerHTML = '';
    await loadMessages();

    const channelName = `messages:${type}:${id}`;
    currentSubscription = supabase.channel(channelName);

    currentSubscription
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: type === 'user'
                ? `or(sender_id.eq.${currentUser.id}.receiver_id.eq.${id},sender_id.eq.${id}.receiver_id.eq.${currentUser.id})`
                : `group_id.eq.${id}`
        }, (payload) => {
            console.log('Новое сообщение из подписки:', payload.new);
            displayMessage(payload.new);
        })
        .subscribe((status) => {
            console.log(`Статус подписки на ${channelName}: ${status}`);
            if (status === 'SUBSCRIBED') {
                console.log(`Успешно подписан на канал ${channelName}`);
            } else if (status === 'TIMED_OUT') {
                console.error(`Тайм-аут подписки на ${channelName}. Проверяйте соединение.`);
            } else if (status === 'CLOSED') {
                console.warn(`Канал ${channelName} закрыт`);
            } else {
                console.error(`Ошибка подписки на ${channelName}: ${status}`);
            }
        });
}

// Загрузка сообщений
async function loadMessages() {
    const chat = document.getElementById('chat');
    chat.innerHTML = '';

    let messagesQuery;
    if (selectedChatType === 'user') {
        messagesQuery = supabase
            .from('messages')
            .select('*, profiles!messages_sender_id_fkey(username)')
            .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${selectedChat}),and(sender_id.eq.${selectedChat},receiver_id.eq.${currentUser.id})`)
            .order('created_at', { ascending: true });
    } else if (selectedChatType === 'group') {
        messagesQuery = supabase
            .from('messages')
            .select('*, profiles!messages_sender_id_fkey(username)')
            .eq('group_id', selectedChat)
            .order('created_at', { ascending: true });
    }

    const { data: messages, error } = await messagesQuery;
    if (error) {
        console.error('Ошибка загрузки сообщений:', error);
        return;
    }

    messages.forEach(message => displayMessage(message));
}

// Отображение сообщения
function displayMessage(message) {
    const chat = document.getElementById('chat');
    if (chat.querySelector(`.message[data-message-id="${message.id}"]`) || 
        chat.querySelector(`.message[data-temp-id="${message.id}"]`)) {
        return;
    }

    const div = document.createElement('div');
    div.classList.add('message');

    if (message.id && !message.id.toString().startsWith('temp')) {
        div.setAttribute('data-message-id', message.id);
    } else {
        div.setAttribute('data-temp-id', message.id);
    }

    if (message.is_system) {
        div.classList.add('system-message');
        div.innerHTML = `<span>${message.text}</span>`;
    } else {
        const isOwnMessage = message.sender_id === currentUser.id;
        div.classList.add(isOwnMessage ? 'own-message' : 'other-message');

        let content = '';
        if (message.text) {
            content += `<p>${message.text}</p>`;
        }
        if (message.media_url) {
            if (message.media_type === 'image') {
                content += `<img src="${message.media_url}" alt="Изображение" class="message-media">`;
            } else if (message.media_type === 'video') {
                content += `
                    <video controls class="message-media">
                        <source src="${message.media_url}" type="${message.media_mime}">
                    </video>
                `;
            } else if (message.media_type === 'audio') {
                content += `
                    <div class="voice-message">
                        <audio controls class="voice-audio">
                            <source src="${message.media_url}" type="${message.media_mime}">
                        </audio>
                    </div>
                `;
            }
        }

        const senderName = message.profiles ? message.profiles.username : 'Неизвестный';
        div.innerHTML = `
            ${selectedChatType === 'group' && !isOwnMessage ? `<span class="sender-name">${senderName}</span>` : ''}
            ${content}
            <span class="timestamp">${formatTimestamp(message.created_at)}</span>
        `;
    }

    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

// Отправка текстового или медиа сообщения
async function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const mediaInput = document.getElementById('messageMediaInput');
    const text = messageInput.value.trim();
    const file = mediaInput.files[0];
    let mediaUrl = null;
    let mediaType = null;
    let mediaMime = null;

    if (!text && !file) {
        alert('Введите текст или выберите файл для отправки!');
        return;
    }
    if (!selectedChat) {
        alert('Выберите чат для отправки сообщения!');
        return;
    }

    if (file) {
        if (file.size > 10 * 1024 * 1024) {
            alert('Файл слишком большой! Максимальный размер — 10 МБ.');
            return;
        }

        const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif'];
        const allowedVideoTypes = ['video/mp4', 'video/webm'];
        if (allowedImageTypes.includes(file.type)) {
            mediaType = 'image';
            mediaMime = file.type;
        } else if (allowedVideoTypes.includes(file.type)) {
            mediaType = 'video';
            mediaMime = file.type;
        } else {
            alert('Поддерживаются только изображения (JPEG, PNG, GIF) и видео (MP4, WebM)!');
            return;
        }

        try {
            mediaUrl = await uploadToCloudinary(file, `chat-media/${selectedChatType}/${selectedChat}`);
        } catch (error) {
            console.error('Ошибка загрузки медиа:', error);
            alert('Ошибка загрузки медиа: ' + error.message);
            return;
        }
    }

    const localMessage = {
        id: Date.now(),
        sender_id: currentUser.id,
        receiver_id: selectedChatType === 'user' ? selectedChat : null,
        group_id: selectedChatType === 'group' ? selectedChat : null,
        text: text || null,
        media_url: mediaUrl || null,
        media_type: mediaType || null,
        media_mime: mediaMime || null,
        is_system: false,
        created_at: new Date().toISOString(),
        profiles: { username: currentUser.profile.username }
    };

    displayMessage(localMessage);

    const messageData = {
        sender_id: currentUser.id,
        receiver_id: selectedChatType === 'user' ? selectedChat : null,
        group_id: selectedChatType === 'group' ? selectedChat : null,
        text: text || null,
        media_url: mediaUrl || null,
        media_type: mediaType || null,
        media_mime: mediaMime || null,
        is_system: false
    };

    const { data, error } = await supabase
        .from('messages')
        .insert(messageData)
        .select()
        .single();

    if (error) {
        console.error('Ошибка отправки сообщения:', error);
        alert('Ошибка отправки сообщения: ' + error.message);
        const chat = document.getElementById('chat');
        const tempMessage = chat.querySelector(`.message[data-temp-id="${localMessage.id}"]`);
        if (tempMessage) tempMessage.remove();
    } else {
        messageInput.value = '';
        mediaInput.value = '';
        document.getElementById('mediaPreview').style.display = 'none';
        document.getElementById('previewImage').style.display = 'none';
        document.getElementById('previewVideo').style.display = 'none';
    }
}

// Визуализация звуковой волны во время записи
function visualizeAudio(stream) {
    const canvas = document.getElementById('audioWaveform');
    const ctx = canvas.getContext('2d');
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioAnalyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(audioAnalyser);
    audioAnalyser.fftSize = 2048;

    const bufferLength = audioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    canvas.width = 300;
    canvas.height = 100;

    function draw() {
        if (!mediaRecorder || mediaRecorder.state !== 'recording') {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        requestAnimationFrame(draw);
        audioAnalyser.getByteTimeDomainData(dataArray);

        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#007bff';

        ctx.beginPath();
        const sliceWidth = canvas.width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * canvas.height) / 2;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            x += sliceWidth;
        }

        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
    }

    draw();
}

// Начало записи голосового сообщения
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = () => {
            audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            stream.getTracks().forEach(track => track.stop());
            audioContext.close();
            showVoicePreview();
        };

        mediaRecorder.start();
        visualizeAudio(stream);

        const recordBtn = document.getElementById('recordVoiceBtn');
        recordBtn.classList.add('recording');
        recordBtn.textContent = '⏹️';
        document.getElementById('audioWaveform').style.display = 'block';
    } catch (error) {
        console.error('Ошибка доступа к микрофону:', error);
        alert('Не удалось получить доступ к микрофону. Проверьте разрешения.');
    }
}

// Остановка записи
function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        const recordBtn = document.getElementById('recordVoiceBtn');
        recordBtn.classList.remove('recording');
        recordBtn.textContent = '🎤';
        document.getElementById('audioWaveform').style.display = 'none';
    }
}

// Предпросмотр голосового сообщения перед отправкой
function showVoicePreview() {
    const previewModal = document.getElementById('voicePreviewModal');
    const audioPreview = document.getElementById('voicePreviewAudio');
    audioPreview.src = URL.createObjectURL(audioBlob);
    previewModal.style.display = 'flex';
}

// Отправка голосового сообщения
async function sendVoiceMessage() {
    if (!selectedChat) {
        alert('Выберите чат для отправки сообщения!');
        return;
    }

    try {
        const audioUrl = await uploadToCloudinary(audioBlob, `chat-media/${selectedChatType}/${selectedChat}`);
        const localMessage = {
            id: Date.now(),
            sender_id: currentUser.id,
            receiver_id: selectedChatType === 'user' ? selectedChat : null,
            group_id: selectedChatType === 'group' ? selectedChat : null,
            text: null,
            media_url: audioUrl,
            media_type: 'audio',
            media_mime: 'audio/webm',
            is_system: false,
            created_at: new Date().toISOString(),
            profiles: { username: currentUser.profile.username }
        };

        displayMessage(localMessage);

        const messageData = {
            sender_id: currentUser.id,
            receiver_id: selectedChatType === 'user' ? selectedChat : null,
            group_id: selectedChatType === 'group' ? selectedChat : null,
            text: null,
            media_url: audioUrl,
            media_type: 'audio',
            media_mime: 'audio/webm',
            is_system: false
        };

        const { data, error } = await supabase
            .from('messages')
            .insert(messageData)
            .select()
            .single();

        if (error) {
            console.error('Ошибка отправки голосового сообщения:', error);
            alert('Ошибка отправки голосового сообщения: ' + error.message);
            const chat = document.getElementById('chat');
            const tempMessage = chat.querySelector(`.message[data-temp-id="${localMessage.id}"]`);
            if (tempMessage) tempMessage.remove();
        }

        document.getElementById('voicePreviewModal').style.display = 'none';
        audioBlob = null;
    } catch (error) {
        console.error('Ошибка загрузки аудио:', error);
        alert('Ошибка загрузки аудио: ' + error.message);
    }
}

// Обработчики для предпросмотра голосового сообщения
document.getElementById('sendVoiceButton').addEventListener('click', sendVoiceMessage);
document.getElementById('cancelVoiceButton').addEventListener('click', () => {
    document.getElementById('voicePreviewModal').style.display = 'none';
    audioBlob = null;
});

// Предпросмотр медиа перед отправкой
document.getElementById('messageMediaInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const preview = document.getElementById('mediaPreview');
    const previewImage = document.getElementById('previewImage');
    const previewVideo = document.getElementById('previewVideo');

    // Очищаем предыдущий предпросмотр
    previewImage.style.display = 'none';
    previewVideo.style.display = 'none';
    previewImage.src = '';
    previewVideo.src = '';

    if (file.size > 10 * 1024 * 1024) {
        alert('Файл слишком большой! Максимальный размер — 10 МБ.');
        e.target.value = '';
        return;
    }

    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif'];
    const allowedVideoTypes = ['video/mp4', 'video/webm'];

    if (allowedImageTypes.includes(file.type)) {
        previewImage.src = URL.createObjectURL(file);
        previewImage.style.display = 'block';
        preview.style.display = 'flex';
    } else if (allowedVideoTypes.includes(file.type)) {
        previewVideo.src = URL.createObjectURL(file);
        previewVideo.style.display = 'block';
        preview.style.display = 'flex';
    } else {
        alert('Поддерживаются только изображения (JPEG, PNG, GIF) и видео (MP4, WebM)!');
        e.target.value = '';
        return;
    }
});

// Отмена предпросмотра медиа
document.getElementById('cancelMediaPreview').addEventListener('click', () => {
    const mediaInput = document.getElementById('messageMediaInput');
    const preview = document.getElementById('mediaPreview');
    const previewImage = document.getElementById('previewImage');
    const previewVideo = document.getElementById('previewVideo');

    mediaInput.value = '';
    preview.style.display = 'none';
    previewImage.style.display = 'none';
    previewVideo.style.display = 'none';
    previewImage.src = '';
    previewVideo.src = '';
});

// Отправка сообщения по нажатию Enter
document.getElementById('messageInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Обработчик кнопки отправки сообщения
document.getElementById('sendMessageBtn').addEventListener('click', sendMessage);

// Обработчик кнопки записи голосового сообщения
document.getElementById('recordVoiceBtn').addEventListener('click', () => {
    const recordBtn = document.getElementById('recordVoiceBtn');
    if (recordBtn.classList.contains('recording')) {
        stopRecording();
    } else {
        startRecording();
    }
});

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    checkUser();
});
