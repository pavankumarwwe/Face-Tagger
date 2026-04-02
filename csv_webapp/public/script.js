document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('table-body');
    const saveStatus = document.getElementById('save-status');
    const saveSpinner = document.getElementById('save-spinner');
    const exportBtn = document.getElementById('export-btn');
    const markCompleteBtn = document.getElementById('mark-complete-btn');
    const reopenBtn = document.getElementById('reopen-btn');
    const fileSelect = document.getElementById('file-select');
    const loadBtn = document.getElementById('load-file-btn');
    const pageTitle = document.getElementById('page-title');
    const pushBtn = document.getElementById('push-btn');
    const clearAllBtn = document.getElementById('clear-all-btn');
    const refBtn = document.getElementById('ref-btn');
    const openMovieBtn = document.getElementById('open-movie-btn');
    const openMovieHelp = document.getElementById('open-movie-help');
    const youtubeModal = document.getElementById('youtube-modal');
    const youtubePlayerDiv = document.getElementById('youtube-player');
    const closeYoutubeModal = document.getElementById('close-youtube-modal');
    const playerHeader = document.getElementById('player-header');
    const videoCurrentTime = document.getElementById('video-current-time');
    const videoDuration = document.getElementById('video-duration');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const playPausePath = document.getElementById('play-pause-path');
    const muteBtn = document.getElementById('mute-btn');
    const volumeIcon = document.getElementById('volume-icon');
    const muteIcon = document.getElementById('mute-icon');
    const seekBackBtn = document.getElementById('seek-back-btn');
    const seekFwdBtn = document.getElementById('seek-fwd-btn');
    const homeLink = document.getElementById('home-link');

    let ytPlayer = null;
    let timeUpdateInterval = null;
    let currentVideoType = null; // 'youtube' or 'googledrive'
    let isPlaying = false;
    let isMuted = false;
    let playerReady = false;

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-dropdown')) {
            document.querySelectorAll('.dropdown-menu').forEach(menu => {
                menu.style.display = 'none';
            });
        }
    });

    let currentSecretCode = '';
    let globalRows = [];
    let globalCastOptions = [];
    let globalAllActors = [];
    let currentFilename = '';
    let currentMovieStatus = 'Not Started';
    let currentMovieLoaded = false;
    let hasUnsavedChanges = false;
    let actorColorSeed = 0;
    let actorColorMap = new Map();
    const rowActorInputModes = new Map();
    const pendingRowRefreshes = new Set();
    let rowRefreshScheduled = false;

    function extractActors(str) {
        if (!str) return [];
        return str.split(/(?=#)/).map(s => s.trim()).filter(Boolean);
    }

    // Apply the current row's actor to later rows with the same speaker.
    // This intentionally only propagates downward so earlier rows keep their tags.
    function applySpeakerMappingDown(rowIndex) {
        const currentRow = globalRows[rowIndex];
        const speaker = currentRow.speaker;

        // Only proceed if this row has a speaker and actors
        if (!speaker || !currentRow.Actors || currentRow.Actors.trim() === '') {
            return;
        }

        const currentActors = extractActors(currentRow.Actors);
        if (currentActors.length === 0) return;

        // Collect only later rows that match the same speaker
        const rowsToUpdate = [];
        for (let i = rowIndex + 1; i < globalRows.length; i++) {
            const row = globalRows[i];
            if (row.speaker !== speaker) continue; // Skip different speakers

            // Reassign the same speaker below this point.
            row.Actors = currentRow.Actors;
            rowsToUpdate.push(i);
        }

        // Update all affected rows sequentially to avoid race conditions
        if (rowsToUpdate.length > 0) {
            updateMultipleRows(rowsToUpdate, 'Actors').then(() => {
                const rowsToRender = new Set();
                rowsToUpdate.forEach(i => {
                    rowsToRender.add(i);
                    rowsToRender.add(i + 1);
                });
                queueRowRefresh(rowsToRender);
            });
        }
    }

    function clearSpeakerTagsDown(rowIndex) {
        const currentRow = globalRows[rowIndex];
        const speaker = currentRow?.speaker;

        if (!speaker) return;

        const rowsToUpdate = [];
        for (let i = rowIndex; i < globalRows.length; i++) {
            const row = globalRows[i];
            if (row.speaker !== speaker) continue;

            row.Actors = '';
            rowsToUpdate.push(i);
        }

        if (rowsToUpdate.length > 0) {
            updateMultipleRows(rowsToUpdate, 'Actors').then(() => {
                const rowsToRender = new Set();
                rowsToUpdate.forEach(i => {
                    rowsToRender.add(i);
                    rowsToRender.add(i + 1);
                });
                queueRowRefresh(rowsToRender);
            });
        }
    }

    function setDirtyStatus(message = 'Unsaved changes') {
        hasUnsavedChanges = true;
        saveStatus.textContent = message;
        saveStatus.style.color = 'var(--text-secondary)';
        saveSpinner.classList.add('hidden');
    }

    function setSavedStatus(message = 'All changes saved') {
        hasUnsavedChanges = false;
        saveStatus.textContent = message;
        saveStatus.style.color = 'var(--success-color)';
        saveSpinner.classList.add('hidden');
    }

    function confirmDiscardChanges(actionLabel) {
        if (!hasUnsavedChanges) return true;
        return confirm(
            `You have unsaved changes.\n\n` +
            `If you continue to ${actionLabel}, your current edits may be lost.\n\n` +
            `Do you want to continue?`
        );
    }

    function getRowActorInputMode(rowIndex) {
        return rowActorInputModes.get(rowIndex) || 'replace-propagate';
    }

    function setRowActorInputMode(rowIndex, mode) {
        if (mode === 'append-row-only') {
            rowActorInputModes.set(rowIndex, mode);
        } else {
            rowActorInputModes.delete(rowIndex);
        }
    }

    function queueRowRefresh(indices) {
        for (const index of indices) {
            if (index >= 0 && index < globalRows.length) {
                pendingRowRefreshes.add(index);
            }
        }

        if (rowRefreshScheduled) return;
        rowRefreshScheduled = true;

        requestAnimationFrame(() => {
            rowRefreshScheduled = false;
            const rows = Array.from(pendingRowRefreshes).sort((a, b) => a - b);
            pendingRowRefreshes.clear();

            const chunkSize = 25;
            const renderChunk = (start) => {
                const slice = rows.slice(start, start + chunkSize);
                slice.forEach((i) => {
                    renderRowOriginalTeluguCell(i);
                    renderRowActorsCell(i);
                });

                if (start + chunkSize < rows.length) {
                    requestAnimationFrame(() => renderChunk(start + chunkSize));
                }
            };

            renderChunk(0);
        });
    }

    function setEditingLocked(locked) {
        if (!tableBody) return;
        tableBody.style.pointerEvents = locked ? 'none' : '';
        tableBody.style.opacity = locked ? '0.6' : '';
    }

    function updateEditorActionVisibility() {
        const loaded = currentMovieLoaded;
        const complete = loaded && currentMovieStatus === 'Complete';

        if (markCompleteBtn) markCompleteBtn.style.display = loaded && !complete ? 'inline-flex' : 'none';
        if (pushBtn) pushBtn.style.display = loaded ? 'inline-flex' : 'none';
        if (clearAllBtn) clearAllBtn.style.display = loaded ? 'inline-flex' : 'none';
        if (reopenBtn) reopenBtn.style.display = complete ? 'inline-flex' : 'none';
        if (exportBtn) exportBtn.style.display = complete ? 'inline-flex' : 'none';
        if (refBtn) refBtn.style.display = loaded ? 'inline-flex' : 'none';
    }

    function setMovieLoaded(loaded) {
        currentMovieLoaded = loaded;
        updateEditorActionVisibility();
    }

    function setMovieStatus(status) {
        currentMovieStatus = status || 'Not Started';

        const isComplete = currentMovieLoaded && currentMovieStatus === 'Complete';
        updateEditorActionVisibility();
        if (pushBtn) pushBtn.disabled = isComplete;
        if (clearAllBtn) clearAllBtn.disabled = isComplete;

        setEditingLocked(isComplete);
    }

    window.addEventListener('beforeunload', (event) => {
        if (!hasUnsavedChanges) return;
        event.preventDefault();
        event.returnValue = '';
    });

    async function readJsonResponse(response) {
        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();

        if (contentType.includes('application/json')) {
            return JSON.parse(text);
        }

        throw new Error(text.trim() || `Unexpected response (${response.status})`);
    }

    async function saveCurrentMovieToCloud() {
        if (!currentFilename) throw new Error('Please load a file first.');

        saveSpinner.classList.remove('hidden');
        saveStatus.textContent = 'Saving to cloud...';
        saveStatus.style.color = 'var(--text-secondary)';

        const movieName = currentFilename.replace('.csv', '').replace('_tagged', '').replace('_transliterated', '').trim();

        const castResponse = await fetch('/api/push-cast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                movieName,
                filename: currentFilename,
                secretCode: currentSecretCode
            })
        });
        const castData = await readJsonResponse(castResponse);
        if (!castData.success) {
            throw new Error(castData.error || 'Failed to save cast changes');
        }

        const pushResponse = await fetch('/api/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: currentFilename,
                secretCode: currentSecretCode,
                rows: globalRows
            })
        });
        const pushData = await readJsonResponse(pushResponse);
        if (!pushData.success) {
            throw new Error(pushData.error || 'Failed to save CSV');
        }

        setSavedStatus('All changes saved');
    }

    // Update multiple rows sequentially
    async function updateMultipleRows(indices, field) {
        if (indices.length > 0) setDirtyStatus();
        return Promise.resolve();
    }
    
    let currentYoutubeUrl = '';

    function updateYoutubeLink(url) {
        if (url) {
            currentYoutubeUrl = url;
            openMovieBtn.style.display = 'inline-flex';
            openMovieHelp.style.display = 'none';
        } else {
            currentYoutubeUrl = '';
            openMovieBtn.style.display = 'none';
            openMovieHelp.style.display = 'inline-block';
        }
    }

    // Load YouTube IFrame API
    let youtubeAPIReady = false;
    window.onYouTubeIframeAPIReady = function() {
        console.log('YouTube IFrame API loaded successfully');
        youtubeAPIReady = true;
    };

    if (!window.YT) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    } else {
        youtubeAPIReady = true;
    }

    // Detect video source type
    function getVideoSourceType(url) {
        if (!url) return null;

        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            return 'youtube';
        } else if (url.includes('drive.google.com')) {
            return 'googledrive';
        }

        return null;
    }

    // Extract YouTube video ID from URL
    function getYoutubeVideoId(url) {
        if (!url) return '';

        let videoId = '';

        // Format: https://www.youtube.com/watch?v=VIDEO_ID
        if (url.includes('youtube.com/watch?v=')) {
            const urlParams = new URLSearchParams(url.split('?')[1]);
            videoId = urlParams.get('v');
        }
        // Format: https://youtu.be/VIDEO_ID
        else if (url.includes('youtu.be/')) {
            videoId = url.split('youtu.be/')[1].split('?')[0].split('&')[0];
        }
        // Format: https://www.youtube.com/embed/VIDEO_ID
        else if (url.includes('youtube.com/embed/')) {
            videoId = url.split('embed/')[1].split('?')[0].split('&')[0];
        }

        return videoId;
    }

    // Extract Google Drive file ID from URL
    function getGoogleDriveFileId(url) {
        if (!url) return '';

        let fileId = '';

        // Format: https://drive.google.com/file/d/FILE_ID/view
        if (url.includes('/file/d/')) {
            const match = url.match(/\/file\/d\/([^\/]+)/);
            if (match) fileId = match[1];
        }
        // Format: https://drive.google.com/open?id=FILE_ID
        else if (url.includes('open?id=')) {
            const urlParams = new URLSearchParams(url.split('?')[1]);
            fileId = urlParams.get('id') || '';
        }

        return fileId;
    }

    // Get Google Drive embed URL
    function getGoogleDriveEmbedUrl(fileId) {
        return `https://drive.google.com/file/d/${fileId}/preview`;
    }

    // Format seconds to MM:SS or H:MM:SS
    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';

        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);

        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        } else {
            return `${m}:${s.toString().padStart(2, '0')}`;
        }
    }

    // Update time display
    function updateTimeDisplay() {
        if (ytPlayer && ytPlayer.getCurrentTime && ytPlayer.getDuration) {
            try {
                const currentTime = ytPlayer.getCurrentTime();
                const duration = ytPlayer.getDuration();

                if (videoCurrentTime) videoCurrentTime.textContent = formatTime(currentTime);
                if (videoDuration) videoDuration.textContent = formatTime(duration);
            } catch (e) {
                // Player not ready yet
            }
        }
    }

    // Update play/pause icon
    function updatePlayPauseIcon() {
        if (!playPausePath) return;

        if (isPlaying) {
            // Show pause icon (two bars)
            playPausePath.setAttribute('d', 'M6 4h4v16H6V4zm8 0h4v16h-4V4z');
            if (playPauseBtn) playPauseBtn.classList.add('playing');
        } else {
            // Show play icon (triangle)
            playPausePath.setAttribute('d', 'M8 5v14l11-7z');
            if (playPauseBtn) playPauseBtn.classList.remove('playing');
        }
    }

    // Update mute icon
    function updateMuteIcon() {
        if (isMuted) {
            if (volumeIcon) volumeIcon.style.display = 'none';
            if (muteIcon) muteIcon.style.display = 'block';
        } else {
            if (volumeIcon) volumeIcon.style.display = 'block';
            if (muteIcon) muteIcon.style.display = 'none';
        }
    }

    // Seek video forward or backward
    function seekVideo(seconds) {
        if (!playerReady || currentVideoType !== 'youtube' || !ytPlayer) {
            console.log('Player not ready for seeking');
            return;
        }

        try {
            if (typeof ytPlayer.getCurrentTime === 'function' && typeof ytPlayer.seekTo === 'function') {
                const currentTime = ytPlayer.getCurrentTime();
                const newTime = Math.max(0, currentTime + seconds);
                ytPlayer.seekTo(newTime, true);
                updateTimeDisplay();
                console.log(`Seeked to ${newTime}s`);
            }
        } catch (e) {
            console.error('Error seeking video:', e);
        }
    }

    // Play/Pause functionality
    function togglePlayPause() {
        if (!playerReady || currentVideoType !== 'youtube' || !ytPlayer) {
            console.log('Player not ready for play/pause');
            return;
        }

        try {
            if (typeof ytPlayer.getPlayerState === 'function' &&
                typeof ytPlayer.playVideo === 'function' &&
                typeof ytPlayer.pauseVideo === 'function') {
                const state = ytPlayer.getPlayerState();
                console.log('Current player state:', state);
                if (state === 1) { // Playing
                    ytPlayer.pauseVideo();
                    console.log('Paused video');
                } else { // Paused or other
                    ytPlayer.playVideo();
                    console.log('Playing video');
                }
            }
        } catch (e) {
            console.error('Error toggling play/pause:', e);
        }
    }

    // Mute/Unmute functionality
    function toggleMute() {
        if (!playerReady || currentVideoType !== 'youtube' || !ytPlayer) {
            console.log('Player not ready for mute/unmute');
            return;
        }

        try {
            if (typeof ytPlayer.isMuted === 'function' &&
                typeof ytPlayer.mute === 'function' &&
                typeof ytPlayer.unMute === 'function') {
                const currentMuteState = ytPlayer.isMuted();
                console.log('Current mute state:', currentMuteState);
                if (currentMuteState) {
                    ytPlayer.unMute();
                    isMuted = false;
                    console.log('Unmuted');
                } else {
                    ytPlayer.mute();
                    isMuted = true;
                    console.log('Muted');
                }
                updateMuteIcon();
            }
        } catch (e) {
            console.error('Error toggling mute:', e);
        }
    }

    // Header playback controls event listeners
    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlayPause();
        });
    }

    if (muteBtn) {
        muteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMute();
        });
    }

    if (seekBackBtn) {
        seekBackBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            seekVideo(-10);
        });
    }

    if (seekFwdBtn) {
        seekFwdBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            seekVideo(10);
        });
    }

    // Initialize YouTube player
    function initYoutubePlayer(videoId) {
        currentVideoType = 'youtube';
        playerReady = false;

        // Clear existing interval
        if (timeUpdateInterval) {
            clearInterval(timeUpdateInterval);
            timeUpdateInterval = null;
        }

        // Destroy existing player
        if (ytPlayer) {
            ytPlayer.destroy();
            ytPlayer = null;
        }

        // Clear player div
        youtubePlayerDiv.innerHTML = '';

        // Update modal title
        const modalTitle = document.getElementById('youtube-modal-title');
        if (modalTitle) modalTitle.textContent = 'YouTube Player';

        // Show time overlay and controls for YouTube
        const timeOverlay = document.querySelector('.video-time-overlay');
        if (timeOverlay) timeOverlay.style.display = 'block';

        const playbackControls = document.querySelector('.playback-controls');
        if (playbackControls) playbackControls.classList.remove('hidden');

        // Wait for YT API to be available
        const checkYT = () => {
            if (youtubeAPIReady && typeof window.YT !== 'undefined' && window.YT.Player) {
                console.log('Creating YouTube player...');
                window.YT.ready(() => {
                    ytPlayer = new window.YT.Player('youtube-player', {
                        videoId: videoId,
                        playerVars: {
                            autoplay: 0,
                            rel: 0,
                            modestbranding: 1,
                        },
                        events: {
                            onReady: (event) => {
                                console.log('YouTube player ready');
                                playerReady = true;

                                // Start time update interval
                                timeUpdateInterval = setInterval(updateTimeDisplay, 500);
                                updateTimeDisplay();

                                // Initialize button states
                                try {
                                    isPlaying = false;
                                    isMuted = ytPlayer.isMuted && ytPlayer.isMuted();
                                    updatePlayPauseIcon();
                                    updateMuteIcon();
                                } catch (e) {
                                    console.error('Error initializing button states:', e);
                                }
                            },
                            onStateChange: (event) => {
                                // Update time whenever state changes
                                updateTimeDisplay();

                                // Update play/pause icon based on state
                                // YT.PlayerState: UNSTARTED=-1, ENDED=0, PLAYING=1, PAUSED=2, BUFFERING=3, CUED=5
                                if (event.data === 1) { // Playing
                                    isPlaying = true;
                                } else if (event.data === 2 || event.data === 0) { // Paused or Ended
                                    isPlaying = false;
                                }
                                updatePlayPauseIcon();
                            }
                        }
                    });
                });
            } else {
                // Retry after 100ms if YT not ready yet
                setTimeout(checkYT, 100);
            }
        };

        checkYT();
    }

    // Initialize Google Drive player
    function initGoogleDrivePlayer(fileId) {
        currentVideoType = 'googledrive';

        // Clear existing interval
        if (timeUpdateInterval) {
            clearInterval(timeUpdateInterval);
            timeUpdateInterval = null;
        }

        // Destroy existing YT player
        if (ytPlayer) {
            ytPlayer.destroy();
            ytPlayer = null;
        }

        // Update modal title
        const modalTitle = document.getElementById('youtube-modal-title');
        if (modalTitle) modalTitle.textContent = 'Google Drive Player';

        // Hide all controls for Google Drive (no API access)
        const timeOverlay = document.querySelector('.video-time-overlay');
        if (timeOverlay) timeOverlay.style.display = 'none';

        const playbackControls = document.querySelector('.playback-controls');
        if (playbackControls) playbackControls.classList.add('hidden');

        // Create iframe for Google Drive
        const embedUrl = getGoogleDriveEmbedUrl(fileId);
        youtubePlayerDiv.innerHTML = `
            <iframe
                src="${embedUrl}"
                width="100%"
                height="100%"
                frameborder="0"
                allow="autoplay"
                style="width: 100%; height: 100%;">
            </iframe>
        `;
    }

    // Open video floating player
    if (openMovieBtn) {
        openMovieBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentYoutubeUrl) {
                const sourceType = getVideoSourceType(currentYoutubeUrl);

                if (sourceType === 'youtube') {
                    const videoId = getYoutubeVideoId(currentYoutubeUrl);
                    if (videoId) {
                        youtubeModal.style.display = 'block';
                        initYoutubePlayer(videoId);
                    }
                } else if (sourceType === 'googledrive') {
                    const fileId = getGoogleDriveFileId(currentYoutubeUrl);
                    if (fileId) {
                        youtubeModal.style.display = 'block';
                        initGoogleDrivePlayer(fileId);
                    }
                } else {
                    alert('Unsupported video source. Please use YouTube or Google Drive links.');
                }
            }
        });
    }

    // Close video player
    if (closeYoutubeModal) {
        closeYoutubeModal.addEventListener('click', (e) => {
            e.stopPropagation();
            youtubeModal.style.display = 'none';

            // Stop video and clear interval
            if (ytPlayer && ytPlayer.stopVideo) {
                ytPlayer.stopVideo();
            }
            if (timeUpdateInterval) {
                clearInterval(timeUpdateInterval);
                timeUpdateInterval = null;
            }

            // Reset player state
            playerReady = false;
            currentVideoType = null;
            isPlaying = false;
            isMuted = false;

            // Clear player div
            youtubePlayerDiv.innerHTML = '';
        });
    }

    // Make player draggable
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;

    if (playerHeader) {
        playerHeader.addEventListener('mousedown', (e) => {
            // Don't drag when clicking buttons, SVGs, or control elements
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SVG' ||
                e.target.tagName === 'PATH' || e.target.tagName === 'POLYGON' ||
                e.target.tagName === 'LINE' || e.target.closest('.playback-controls') ||
                e.target.closest('.modal-controls')) {
                return;
            }

            isDragging = true;
            e.preventDefault(); // Prevent text selection
            initialX = e.clientX - youtubeModal.offsetLeft;
            initialY = e.clientY - youtubeModal.offsetTop;

            // Remove position class when dragging
            youtubeModal.className = 'youtube-modal';

            // Disable text selection on body during drag
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                e.preventDefault();
                e.stopPropagation();

                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;

                youtubeModal.style.left = currentX + 'px';
                youtubeModal.style.top = currentY + 'px';
                youtubeModal.style.right = 'auto';
                youtubeModal.style.bottom = 'auto';
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                // Re-enable text selection
                document.body.style.userSelect = '';
            }
        });
    }

    // Close player with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && youtubeModal.style.display === 'block') {
            youtubeModal.style.display = 'none';

            // Stop video and clear interval
            if (ytPlayer && ytPlayer.stopVideo) {
                ytPlayer.stopVideo();
            }
            if (timeUpdateInterval) {
                clearInterval(timeUpdateInterval);
                timeUpdateInterval = null;
            }

            // Reset player state
            playerReady = false;
            currentVideoType = null;
            isPlaying = false;
            isMuted = false;

            // Clear player div
            youtubePlayerDiv.innerHTML = '';
        }
    });

    fetch('/api/files')
        .then(res => res.json())
        .then(data => {
            if (data.files && data.files.length > 0) {
                fileSelect.innerHTML = data.files.map(f => `<option value="${f}">${f.replace('_transliterated', '')}</option>`).join('');
                if (data.currentFile) fileSelect.value = data.currentFile;
                
                const urlParams = new URLSearchParams(window.location.search);
                const fileParam = urlParams.get('file');
                if (fileParam && data.files.includes(fileParam)) {
                    fileSelect.value = fileParam;
                    // Trigger click after a tiny delay to ensure everything is ready
                    setTimeout(() => loadBtn.click(), 50);
                }
            }
        });

    loadBtn.addEventListener('click', () => {
        const filename = fileSelect.value;
        if (!filename) return;

        if (!confirmDiscardChanges(`load ${filename}`)) {
            return;
        }
        
        let code = 'pavanKPK5038';
        if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            code = prompt(`Please enter the secret code for ${filename}:`);
            if (code === null) return;
        }
        
        loadBtn.textContent = 'Loading...';
        loadBtn.disabled = true;

        fetch('/api/load', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, secretCode: code })
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                let errorMsg = data.error;
                if (data.attemptsLeft !== undefined && data.attemptsLeft > 0) {
                    errorMsg += `\n\nAttempts remaining: ${data.attemptsLeft}`;
                } else if (data.blockedFor) {
                    errorMsg += `\n\nYou have been blocked for ${data.blockedFor} minutes.`;
                }
                alert(errorMsg);
                return;
            }
            currentSecretCode = code;
            currentFilename = filename;
            const pureName = data.currentFile.replace('.csv', '').replace('_tagged', '').replace('_transliterated', '').trim();
            pageTitle.textContent = `CSV Manager - ${pureName}`;

            if (refBtn) {
                refBtn.href = `/reference.html?movie=${encodeURIComponent(pureName)}`;
            }

            globalRows = data.rows;
            globalCastOptions = data.castOptions || [];
            globalAllActors = data.allActors || [];
            updateYoutubeLink(data.youtubeUrl);
            rebuildActorColorMap();
            setMovieLoaded(true);
            setSavedStatus('Ready');
            setMovieStatus(data.status || 'Not Started');
            renderTable();
        })
        .finally(() => {
            loadBtn.textContent = 'Load';
            loadBtn.disabled = false;
        });
    });

    if (homeLink) {
        homeLink.addEventListener('click', (event) => {
            if (confirmDiscardChanges('go home')) {
                return;
            }

            event.preventDefault();
        });
    }

    fetch('/api/data')
        .then(res => res.json())
        .then(data => {
            if (data.requiresAuth) {
                pageTitle.textContent = `Please Select Movie & Enter Code`;
                globalRows = [];
                setMovieLoaded(false);
                setMovieStatus('Not Started');
                renderTable();
                return;
            }
        })
        .catch(err => {
            console.error('Error fetching data:', err);
            saveStatus.textContent = 'Error loading data';
            saveStatus.style.color = '#ef4444';
        });

    function renderTable() {
        tableBody.innerHTML = '';
        const fragment = document.createDocumentFragment();

        globalRows.forEach((row, i) => {
            const tr = document.createElement('tr');

            tr.innerHTML = `
                <td class="readonly-cell">${escapeHtml(row.start_time || '')}</td>
                <td class="readonly-cell">${escapeHtml(row.end_time || '')}</td>
                <td class="readonly-cell">${escapeHtml(row.speaker || '')}</td>
            `;

            const tdActors = document.createElement('td');
            tdActors.className = 'actors-cell';
            tdActors.id = 'actors-cell-' + i;
            tr.appendChild(tdActors);

            const tdOriginal = document.createElement('td');
            tdOriginal.className = 'readonly-cell original-telugu-cell';
            tdOriginal.id = 'original-telugu-cell-' + i;
            tr.appendChild(tdOriginal);

            fragment.appendChild(tr);
        });

        tableBody.appendChild(fragment);

        globalRows.forEach((row, i) => {
            renderRowOriginalTeluguCell(i);
            renderRowActorsCell(i);
        });
    }

    function hashString(value) {
        let hash = 0;
        for (let i = 0; i < value.length; i++) {
            hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
        }
        return Math.abs(hash);
    }

    function normalizeActorName(actor) {
        return actor.replace(/^#/, '').trim().toLowerCase();
    }

    function shuffleWithSeed(items, seed) {
        const shuffled = [...items];
        let state = seed || 1;

        for (let i = shuffled.length - 1; i > 0; i--) {
            state = (state * 1664525 + 1013904223) >>> 0;
            const j = state % (i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        return shuffled;
    }

    function createActorPillColors(index, total, seed) {
        const safeTotal = Math.max(total, 1);
        const hueOffset = seed % 360;
        const hue = (hueOffset + Math.round((index * 360) / safeTotal)) % 360;
        const saturation = 84 - ((index % 4) * 6);
        const lightness = 88 - ((index % 5) * 3);

        return {
            bg: `hsl(${hue} ${saturation}% ${lightness}%)`,
            fg: `hsl(${hue} 72% 30%)`,
            hoverBg: `hsl(${hue} ${saturation}% ${Math.max(lightness - 8, 72)}%)`,
            hoverFg: `hsl(${hue} 74% 22%)`
        };
    }

    function rebuildActorColorMap() {
        const seen = new Set();
        const uniqueActors = [];

        [...globalCastOptions, ...globalRows.flatMap(row => extractActors(row.Actors))].forEach(actor => {
            const key = normalizeActorName(actor);
            if (!key || seen.has(key)) return;
            seen.add(key);
            uniqueActors.push(actor);
        });

        actorColorSeed = hashString(currentFilename || currentSecretCode || 'cast-colors');
        actorColorMap = new Map();

        shuffleWithSeed(uniqueActors, actorColorSeed).forEach((actor, index) => {
            actorColorMap.set(normalizeActorName(actor), createActorPillColors(index, uniqueActors.length, actorColorSeed));
        });
    }

    function getActorPillColors(actor) {
        const key = normalizeActorName(actor);
        if (!key) {
            return {
                bg: '#e0e7ff',
                fg: '#2563eb',
                hoverBg: '#dbeafe',
                hoverFg: '#1d4ed8'
            };
        }

        if (!actorColorMap.has(key)) {
            actorColorMap.set(key, createActorPillColors(actorColorMap.size, actorColorMap.size + 1, actorColorSeed));
        }

        return actorColorMap.get(key);
    }

    function applyActorPillColors(pill, actor) {
        const colors = getActorPillColors(actor);
        pill.style.setProperty('--pill-bg', colors.bg);
        pill.style.setProperty('--pill-fg', colors.fg);
        pill.style.setProperty('--pill-hover-bg', colors.hoverBg);
        pill.style.setProperty('--pill-hover-fg', colors.hoverFg);
    }

    function renderRowOriginalTeluguCell(i) {
        if (i < 0 || i >= globalRows.length) return;
        const row = globalRows[i];
        const tdOriginal = document.getElementById('original-telugu-cell-' + i);
        if (!tdOriginal) return;

        tdOriginal.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'original-telugu-wrapper';

        const textSpan = document.createElement('span');
        textSpan.className = 'original-telugu-text';
        textSpan.textContent = row.original_telugu || '';
        wrapper.appendChild(textSpan);

        const actionWrap = document.createElement('span');
        actionWrap.className = 'original-telugu-actions';

        const currentActors = extractActors(row.Actors);
        if (currentActors.length > 0) {
            currentActors.forEach(actor => {
                const pill = document.createElement('span');
                pill.className = 'actor-pill actor-pill-inline';
                pill.textContent = actor;
                pill.title = 'Click to remove actor from this row';
                applyActorPillColors(pill, actor);
                pill.addEventListener('click', () => {
                    const updatedActors = currentActors.filter(a => a !== actor);
                    const newText = updatedActors.join(' ');

                    row.Actors = newText;
                    updateBackendMemory(i, 'Actors', newText);

                    renderRowOriginalTeluguCell(i);
                    renderRowActorsCell(i);
                    renderRowOriginalTeluguCell(i + 1);
                });
                actionWrap.appendChild(pill);
            });

            const addActorBtn = document.createElement('button');
            addActorBtn.className = 'btn-copy btn-copy-inline btn-add-inline-actor';
            addActorBtn.textContent = '+ Actor';
            addActorBtn.title = 'Add another actor to this row only';
            addActorBtn.type = 'button';
            addActorBtn.addEventListener('click', () => {
                setRowActorInputMode(i, 'append-row-only');
                renderRowActorsCell(i);
                const actorInput = document.querySelector(`#actors-cell-${i} .tag-actor-input`);
                if (actorInput) {
                    actorInput.focus();
                    actorInput.dispatchEvent(new Event('input', { bubbles: true }));
                    if (typeof actorInput.showPicker === 'function') {
                        actorInput.showPicker();
                    }
                }
            });
            actionWrap.appendChild(addActorBtn);
        }

        if (i > 0) {
            const prevRow = globalRows[i - 1];
            const prevActors = extractActors(prevRow.Actors);
            const newToAdd = prevActors.filter(p => !currentActors.includes(p));

            if (newToAdd.length > 0) {
                const copyBtn = document.createElement('button');
                copyBtn.className = 'btn-copy btn-copy-inline';
                copyBtn.textContent = 'Copy Previous';
                copyBtn.title = 'Copy actors from previous row';

                copyBtn.addEventListener('click', () => {
                    const oldVal = row.Actors || '';
                    const currentText = oldVal.trim();
                    const newText = currentText ? `${currentText} ${newToAdd.join(' ')}` : newToAdd.join(' ');

                    row.Actors = newText;
                    updateBackendMemory(i, 'Actors', newText);

                    renderRowOriginalTeluguCell(i);
                    renderRowActorsCell(i);
                    renderRowOriginalTeluguCell(i + 1);
                });

                actionWrap.appendChild(copyBtn);
            }
        }

        if (actionWrap.childNodes.length > 0) {
            wrapper.appendChild(actionWrap);
        }

        tdOriginal.appendChild(wrapper);
    }

    function renderRowActorsCell(i) {
        if (i < 0 || i >= globalRows.length) return;
        const row = globalRows[i];
        const tdActors = document.getElementById('actors-cell-' + i);
        if (!tdActors) return;

        tdActors.innerHTML = '';
        
        const container = document.createElement('div');
        container.className = 'actors-container';
        
        const currentActors = extractActors(row.Actors);
        const currentCheck = currentActors.map(a => a.substring(1)); // Remove '#'
        const inputMode = getRowActorInputMode(i);

        // 1. Movie Cast combobox (single typeable dropdown)
        if (globalCastOptions.length > 0) {
            const tagActorInput = document.createElement('input');
            tagActorInput.type = 'text';
            tagActorInput.className = 'tag-actor-input';
            tagActorInput.placeholder = inputMode === 'append-row-only' ? 'Add actor to this row' : 'Tag Actor';
            tagActorInput.title = inputMode === 'append-row-only'
                ? 'Type or pick an actor to add only to this row'
                : 'Type or pick an actor to tag';
            tagActorInput.autocomplete = 'off';
            tagActorInput.setAttribute('list', `cast-options-${i}`);
            tagActorInput.setAttribute('aria-label', 'Tag Actor');
            if (inputMode === 'append-row-only') {
                tagActorInput.classList.add('tag-actor-input-append');
            }

            const datalist = document.createElement('datalist');
            datalist.id = `cast-options-${i}`;

            const sortedMovieCast = [...globalCastOptions].sort((a, b) => a.localeCompare(b));

            const renderCastOptions = () => {
                const query = tagActorInput.value.trim().toLowerCase();
                const optionsHtml = [];

                sortedMovieCast.forEach(cast => {
                    if (currentCheck.includes(cast)) return;
                    if (query && !cast.toLowerCase().includes(query)) return;
                    optionsHtml.push(`<option value="${escapeHtml(cast)}"></option>`);
                });

                datalist.innerHTML = optionsHtml.join('');
            };

            const commitCastValue = () => {
                const val = tagActorInput.value.trim();
                if (!val) return;

                const matchedCast = sortedMovieCast.find(cast =>
                    cast.toLowerCase() === val.toLowerCase()
                );
                if (!matchedCast || currentCheck.includes(matchedCast)) {
                    tagActorInput.value = '';
                    renderCastOptions();
                    return;
                }

                const actorToken = `#${matchedCast.trim()}`;
                const newText = inputMode === 'append-row-only' && currentActors.length > 0
                    ? `${row.Actors.trim()} ${actorToken}`.trim()
                    : actorToken;

                row.Actors = newText;
                updateBackendMemory(i, 'Actors', newText);
                setRowActorInputMode(i, 'replace-propagate');

                tagActorInput.value = '';
                renderRowOriginalTeluguCell(i);
                renderRowActorsCell(i);
                renderRowOriginalTeluguCell(i + 1);

                if (inputMode !== 'append-row-only') {
                    // Reassign this speaker only in the rows below the current one
                    applySpeakerMappingDown(i);
                }
            };

            tagActorInput.addEventListener('input', renderCastOptions);
            tagActorInput.addEventListener('change', commitCastValue);
            tagActorInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commitCastValue();
                }
            });

            renderCastOptions();

            container.appendChild(tagActorInput);
            container.appendChild(datalist);
        } else {
            const emptyTagInput = document.createElement('input');
            emptyTagInput.type = 'text';
            emptyTagInput.className = 'tag-actor-input';
            emptyTagInput.placeholder = 'Tag Actor';
            emptyTagInput.disabled = true;
            emptyTagInput.title = 'No cast list found for this movie';
            container.appendChild(emptyTagInput);
        }

        // 2. Add Extra Cast Button (shows all actors with search)
        if (globalAllActors.length > 0) {
            const extraCastBtn = document.createElement('button');
            extraCastBtn.className = 'btn-extra-cast';
            extraCastBtn.innerHTML = '🔍';
            extraCastBtn.title = 'Search & add from all actors';
            extraCastBtn.type = 'button';
            extraCastBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showAllActorsModal(i);
            });
            container.appendChild(extraCastBtn);
        }

        // 3. Clear Speaker Tags Button (if speaker exists)
        if (row.speaker) {
            const clearBtn = document.createElement('button');
            clearBtn.className = 'btn-clear-speaker';
            clearBtn.innerHTML = '🗑';
            clearBtn.title = `Clear all tags for ${row.speaker} from this row downward`;
            clearBtn.type = 'button';
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                clearSpeakerTagsDown(i);
            });
            container.appendChild(clearBtn);
        }

        tdActors.appendChild(container);
    }

    function updateBackendMemory(arrayIndex, field, value) {
        setDirtyStatus();
    }

    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', async () => {
            if (!currentFilename) return alert('Please load a file first.');

            const confirmed = confirm(
                '⚠️ Clear All Actor Tags?\n\n' +
                'This will remove ALL actor tags from ALL rows in this file.\n' +
                'This action cannot be undone.\n\n' +
                'Are you sure you want to continue?'
            );

            if (!confirmed) return;

            const password = prompt(`Enter the password for ${currentFilename} before clearing all tags:`);
            if (password === null) return;
            if (password !== currentSecretCode) {
                alert('Incorrect password.');
                return;
            }

            const ogText = clearAllBtn.textContent;
            clearAllBtn.textContent = 'Clearing...';
            clearAllBtn.disabled = true;

            // Clear all actors in memory
            const rowsToUpdate = [];
            globalRows.forEach((row, i) => {
                if (row.Actors && row.Actors.trim() !== '') {
                    row.Actors = '';
                    rowsToUpdate.push(i);
                }
            });

            if (rowsToUpdate.length > 0) {
                await updateMultipleRows(rowsToUpdate, 'Actors');
                // Re-render ALL rows because "Copy Previous" buttons depend on previous row state
                queueRowRefresh(globalRows.map((_, i) => i));
            }

            setDirtyStatus('All tags cleared');
            clearAllBtn.textContent = ogText;
            clearAllBtn.disabled = false;
        });
    }

    if (pushBtn) {
        pushBtn.addEventListener('click', async () => {
            const ogText = pushBtn.textContent;
            pushBtn.textContent = 'Saving...';
            pushBtn.disabled = true;

            try {
                await saveCurrentMovieToCloud();
                alert('Successfully saved changes to Fly cloud storage.');
            } catch (err) {
                console.error(err);
                saveStatus.textContent = 'Push failed';
                saveStatus.style.color = '#ef4444';
                alert('Failed to save: ' + (err.message || 'Unknown error'));
            } finally {
                pushBtn.textContent = ogText;
                pushBtn.disabled = false;
                saveSpinner.classList.add('hidden');
            }
        });
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (!currentFilename) return alert('Please load a file first.');
            window.location.href = `/api/export?filename=${encodeURIComponent(currentFilename)}`;
        });
    }

    if (markCompleteBtn) {
        markCompleteBtn.addEventListener('click', async () => {
            if (!currentFilename) return alert('Please load a file first.');

            const confirmed = confirm(
                'Mark this movie as Complete?\n\n' +
                'This will lock editing until it is reopened with the password.'
            );

            if (!confirmed) return;

            const ogText = markCompleteBtn.textContent;
            markCompleteBtn.textContent = 'Completing...';
            markCompleteBtn.disabled = true;

            try {
                await saveCurrentMovieToCloud();

                const response = await fetch('/api/status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        filename: currentFilename,
                        status: 'Complete'
                    })
                });
                const data = await readJsonResponse(response);
                if (!data.success) {
                    throw new Error(data.error || 'Failed to mark movie complete');
                }

                setMovieStatus('Complete');
                setSavedStatus('Movie marked complete');
                alert('Movie marked complete. You can export the finished CSV now.');
            } catch (err) {
                console.error(err);
                alert('Failed to mark as complete: ' + (err.message || 'Unknown error'));
            } finally {
                markCompleteBtn.textContent = ogText;
                markCompleteBtn.disabled = false;
                saveSpinner.classList.add('hidden');
            }
        });
    }

    if (reopenBtn) {
        reopenBtn.addEventListener('click', async () => {
            if (!currentFilename) return alert('Please load a file first.');

            const code = prompt('Enter the universal password to reopen this completed movie:');
            if (code === null) return;

            const ogText = reopenBtn.textContent;
            reopenBtn.textContent = 'Reopening...';
            reopenBtn.disabled = true;

            try {
                const response = await fetch('/api/status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        filename: currentFilename,
                        status: 'In Progress',
                        secretCode: code
                    })
                });
                const data = await readJsonResponse(response);
                if (!data.success) {
                    throw new Error(data.error || 'Failed to reopen movie');
                }

                setMovieStatus('In Progress');
                setSavedStatus('Movie reopened for editing');
                alert('Movie reopened. You can edit it again now.');
            } catch (err) {
                console.error(err);
                alert('Failed to reopen: ' + (err.message || 'Unknown error'));
            } finally {
                reopenBtn.textContent = ogText;
                reopenBtn.disabled = false;
            }
        });
    }

    function escapeHtml(unsafe) {
        if(!unsafe) return '';
        return unsafe
             .toString()
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // Show modal with all actors and search
    function showAllActorsModal(rowIndex) {
        const existingModal = document.getElementById('all-actors-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'all-actors-modal';
        modal.className = 'actor-modal';

        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Select Cast from All Actors Available</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="text" id="actor-search" class="modal-search" placeholder="Search actors...">
                    <div id="actors-list" class="actors-list"></div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const searchInput = modal.querySelector('#actor-search');
        const actorsList = modal.querySelector('#actors-list');
        const closeBtn = modal.querySelector('.modal-close');

        // Render all actors
        function renderActorsList(filter = '') {
            const currentActors = extractActors(globalRows[rowIndex].Actors);
            const currentCheck = currentActors.map(a => a.substring(1));

            const filteredActors = globalAllActors.filter(actor =>
                !currentCheck.includes(actor) &&
                actor.toLowerCase().includes(filter.toLowerCase())
            );

            actorsList.innerHTML = filteredActors.map(actor =>
                `<div class="actor-item" data-actor="${escapeHtml(actor)}">${escapeHtml(actor)}</div>`
            ).join('');

            actorsList.querySelectorAll('.actor-item').forEach(item => {
                item.addEventListener('click', () => {
                    const actorName = item.dataset.actor;
                    addActorToRow(rowIndex, actorName);
                    modal.remove();
                });
            });
        }

        renderActorsList();

        searchInput.addEventListener('input', (e) => {
            renderActorsList(e.target.value);
        });

        closeBtn.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        setTimeout(() => searchInput.focus(), 100);
    }

    // Show modal to reassign speaker
    function showReassignModal(rowIndex, speaker) {
        const existingModal = document.getElementById('reassign-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'reassign-modal';
        modal.className = 'actor-modal';

        const currentActors = extractActors(globalRows[rowIndex].Actors).join(', ');

        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Reassign ${speaker}</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <p style="margin-bottom: 1rem; color: #475569;">
                        Current: <strong>${currentActors}</strong><br>
                        This will replace actors for ALL rows with <strong>${speaker}</strong>
                    </p>
                    <input type="text" id="reassign-search" class="modal-search" placeholder="Search actors...">
                    <div id="reassign-list" class="actors-list"></div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const searchInput = modal.querySelector('#reassign-search');
        const actorsList = modal.querySelector('#reassign-list');
        const closeBtn = modal.querySelector('.modal-close');

        // Render all actors (including currently selected ones for replacement)
        function renderActorsList(filter = '') {
            const allActors = [...globalCastOptions, ...globalAllActors]
                .filter((v, i, a) => a.indexOf(v) === i) // unique
                .sort();

            const filteredActors = allActors.filter(actor =>
                actor.toLowerCase().includes(filter.toLowerCase())
            );

            actorsList.innerHTML = filteredActors.map(actor =>
                `<div class="actor-item" data-actor="${escapeHtml(actor)}">${escapeHtml(actor)}</div>`
            ).join('');

            actorsList.querySelectorAll('.actor-item').forEach(item => {
                item.addEventListener('click', () => {
                    const actorName = item.dataset.actor;
                    reassignSpeaker(speaker, actorName);
                    modal.remove();
                });
            });
        }

        renderActorsList();

        searchInput.addEventListener('input', (e) => {
            renderActorsList(e.target.value);
        });

        closeBtn.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        setTimeout(() => searchInput.focus(), 100);
    }

    // Add actor to a specific row (from "Select Actor from All Actors" modal)
    async function addActorToRow(rowIndex, actorName) {
        const row = globalRows[rowIndex];
        const newText = `#${actorName.trim()}`;

        row.Actors = newText;
        updateBackendMemory(rowIndex, 'Actors', newText);

        renderRowOriginalTeluguCell(rowIndex);
        renderRowActorsCell(rowIndex);
        renderRowOriginalTeluguCell(rowIndex + 1);

        // Reassign this speaker only in the rows below the current one
        applySpeakerMappingDown(rowIndex);

        // Add actor to movie cast if not already there
        try {
            const movieName = currentFilename.replace('.csv', '').replace('_tagged', '').replace('_transliterated', '').trim();

            const response = await fetch('/api/add-to-cast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    movieName: movieName,
                    actorName: actorName,
                    secretCode: currentSecretCode,
                    filename: currentFilename
                })
            });

            const data = await response.json();
            if (data.success && data.cast) {
                // Update global cast options
                globalCastOptions = data.cast;
                rebuildActorColorMap();
                console.log(`✅ ${actorName} added to movie cast`);

                // Re-render all rows to show updated dropdown
                queueRowRefresh(globalRows.map((_, i) => i));
            }
        } catch (err) {
            console.error('Error adding to cast:', err);
        }
    }

    // Reassign all rows with a speaker to a new actor
    async function reassignSpeaker(speaker, newActor) {
        const rowsToUpdate = [];

        globalRows.forEach((row, i) => {
            if (row.speaker === speaker) {
                row.Actors = `#${newActor}`;
                rowsToUpdate.push(i);
            }
        });

        if (rowsToUpdate.length > 0) {
            await updateMultipleRows(rowsToUpdate, 'Actors');
            setDirtyStatus('Speaker reassigned');

            const rowsToRender = new Set();
            rowsToUpdate.forEach(i => {
                rowsToRender.add(i);
                rowsToRender.add(i + 1);
            });
            queueRowRefresh(rowsToRender);
        }
    }

});
