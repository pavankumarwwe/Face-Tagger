document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('table-body');
    const saveStatus = document.getElementById('save-status');
    const saveSpinner = document.getElementById('save-spinner');
    const fileSelect = document.getElementById('file-select');
    const loadBtn = document.getElementById('load-file-btn');
    const pageTitle = document.getElementById('page-title');
    const pushBtn = document.getElementById('push-btn');
    const clearAllBtn = document.getElementById('clear-all-btn');
    const openMovieBtn = document.getElementById('open-movie-btn');
    const openMovieHelp = document.getElementById('open-movie-help');
    const youtubeModal = document.getElementById('youtube-modal');
    const youtubePlayerDiv = document.getElementById('youtube-player');
    const closeYoutubeModal = document.getElementById('close-youtube-modal');
    const positionToggle = document.getElementById('position-toggle');
    const playerHeader = document.getElementById('player-header');
    const videoCurrentTime = document.getElementById('video-current-time');
    const videoDuration = document.getElementById('video-duration');

    let ytPlayer = null;
    let timeUpdateInterval = null;

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

    function extractActors(str) {
        if (!str) return [];
        return str.split(/(?=#)/).map(s => s.trim()).filter(Boolean);
    }

    // Apply actor to all rows with same speaker that have no actors
    function applySpeakerMapping(rowIndex) {
        const currentRow = globalRows[rowIndex];
        const speaker = currentRow.speaker;

        // Only proceed if this row has a speaker and actors
        if (!speaker || !currentRow.Actors || currentRow.Actors.trim() === '') {
            return;
        }

        const currentActors = extractActors(currentRow.Actors);
        if (currentActors.length === 0) return;

        // Collect all rows that need updating
        const rowsToUpdate = [];
        globalRows.forEach((row, i) => {
            if (i === rowIndex) return; // Skip current row
            if (row.speaker !== speaker) return; // Skip different speakers
            if (row.Actors && row.Actors.trim() !== '') return; // Skip rows that already have actors

            // Apply the actors from current row
            row.Actors = currentRow.Actors;
            rowsToUpdate.push(i);
        });

        // Update all affected rows sequentially to avoid race conditions
        if (rowsToUpdate.length > 0) {
            updateMultipleRows(rowsToUpdate, 'Actors').then(() => {
                // Re-render all affected cells after all updates are done
                rowsToUpdate.forEach(i => renderRowActorsCell(i));
            });
        }
    }

    // Update multiple rows sequentially
    async function updateMultipleRows(indices, field) {
        for (const i of indices) {
            await new Promise((resolve) => {
                const value = globalRows[i][field];
                fetch('/api/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ arrayIndex: i, field, value, filename: currentFilename, secretCode: currentSecretCode })
                })
                .then(res => res.json())
                .then(data => {
                    if (!data.success) {
                        console.error('Failed to update row', i);
                    }
                    resolve();
                })
                .catch(err => {
                    console.error('Error updating row', i, err);
                    resolve();
                });
            });
        }
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
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

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

    // Initialize YouTube player
    function initYoutubePlayer(videoId) {
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

        // Wait for YT API to be available
        const checkYT = () => {
            if (typeof window.YT !== 'undefined' && window.YT.Player) {
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
                                // Start time update interval
                                timeUpdateInterval = setInterval(updateTimeDisplay, 500);
                                updateTimeDisplay();
                            },
                            onStateChange: (event) => {
                                // Update time whenever state changes
                                updateTimeDisplay();
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

    // Open YouTube floating player
    if (openMovieBtn) {
        openMovieBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentYoutubeUrl) {
                const videoId = getYoutubeVideoId(currentYoutubeUrl);
                if (videoId) {
                    youtubeModal.style.display = 'block';
                    initYoutubePlayer(videoId);
                }
            }
        });
    }

    // Close YouTube player
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
        });
    }

    // Position toggle (cycle through positions)
    let currentPosition = 0;
    const positions = ['position-top-right', 'position-top-left', 'position-bottom-right', 'position-bottom-left'];

    if (positionToggle) {
        positionToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            currentPosition = (currentPosition + 1) % positions.length;
            youtubeModal.className = 'youtube-modal ' + positions[currentPosition];
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
            if (e.target.tagName === 'BUTTON') return; // Don't drag when clicking buttons

            isDragging = true;
            initialX = e.clientX - youtubeModal.offsetLeft;
            initialY = e.clientY - youtubeModal.offsetTop;

            // Remove position class when dragging
            youtubeModal.className = 'youtube-modal';
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;

                youtubeModal.style.left = currentX + 'px';
                youtubeModal.style.top = currentY + 'px';
                youtubeModal.style.right = 'auto';
                youtubeModal.style.bottom = 'auto';
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
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
        }
    });

    fetch('/api/files')
        .then(res => res.json())
        .then(data => {
            if (data.files && data.files.length > 0) {
                fileSelect.innerHTML = data.files.map(f => `<option value="${f}">${f}</option>`).join('');
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
            currentFilename = data.currentFile;
            const pureName = data.currentFile.replace('.csv', '').replace('_tagged', '').trim();
            pageTitle.textContent = `CSV Manager - ${pureName}`;
            
            const refBtn = document.getElementById('ref-btn');
            if (refBtn) {
                refBtn.href = `/reference.html?movie=${encodeURIComponent(pureName)}`;
                refBtn.style.display = 'inline-flex';
            }

            globalRows = data.rows;
            globalCastOptions = data.castOptions || [];
            globalAllActors = data.allActors || [];
            updateYoutubeLink(data.youtubeUrl);
            renderTable();
        })
        .finally(() => {
            loadBtn.textContent = 'Load';
            loadBtn.disabled = false;
        });
    });

    fetch('/api/data')
        .then(res => res.json())
        .then(data => {
            if (data.requiresAuth) {
                pageTitle.textContent = `Please Select Movie & Enter Code`;
                globalRows = [];
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
                <td class="readonly-cell">${escapeHtml(row.original_telugu || '')}</td>
            `;

            const tdActors = document.createElement('td');
            tdActors.className = 'actors-cell';
            tdActors.id = 'actors-cell-' + i;
            tr.appendChild(tdActors);

            fragment.appendChild(tr);
        });

        tableBody.appendChild(fragment);

        globalRows.forEach((row, i) => {
            renderRowActorsCell(i);
        });
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

        // 1. Movie Cast Dropdown (simple select)
        if (globalCastOptions.length > 0) {
            const select = document.createElement('select');
            const optionsHtml = ['<option value="">Select Cast</option>'];

            const sortedMovieCast = [...globalCastOptions].sort((a, b) => a.localeCompare(b));
            sortedMovieCast.forEach(cast => {
                if (!currentCheck.includes(cast)) {
                    optionsHtml.push(`<option value="${escapeHtml(cast)}">${escapeHtml(cast)}</option>`);
                }
            });
            select.innerHTML = optionsHtml.join('');

            select.addEventListener('change', (e) => {
                const val = e.target.value;
                if (!val) return;

                const oldVal = row.Actors || '';
                const currentText = oldVal.trim();
                const newText = currentText ? `${currentText} #${val.trim()}` : `#${val.trim()}`;

                row.Actors = newText;
                updateBackendMemory(i, 'Actors', newText);

                renderRowActorsCell(i);
                renderRowActorsCell(i + 1);

                // Apply to all rows with same speaker ONLY when using Select Cast dropdown
                applySpeakerMapping(i);
            });

            if (optionsHtml.length > 1) {
                container.appendChild(select);
            }
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

        // 3. Reassign Speaker Button (if speaker exists and actors exist)
        if (row.speaker && currentActors.length > 0) {
            const reassignBtn = document.createElement('button');
            reassignBtn.className = 'btn-reassign-speaker';
            reassignBtn.innerHTML = '🔄';
            reassignBtn.title = `Reassign all ${row.speaker} rows`;
            reassignBtn.type = 'button';
            reassignBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showReassignModal(i, row.speaker);
            });
            container.appendChild(reassignBtn);
        }

        // 4. Copy Previous Button (only if previous row has actors)
        if (i > 0) {
            const prevRow = globalRows[i - 1];
            const prevActors = extractActors(prevRow.Actors);
            const newToAdd = prevActors.filter(p => !currentActors.includes(p));

            if (newToAdd.length > 0) {
                const copyBtn = document.createElement('button');
                copyBtn.className = 'btn-copy';
                copyBtn.textContent = 'Copy Previous';
                copyBtn.title = 'Copy actors from previous row';

                copyBtn.addEventListener('click', () => {
                    const oldVal = row.Actors || '';
                    const currentText = oldVal.trim();
                    const newText = currentText ? `${currentText} ${newToAdd.join(' ')}` : newToAdd.join(' ');

                    row.Actors = newText;
                    updateBackendMemory(i, 'Actors', newText);

                    renderRowActorsCell(i);
                    renderRowActorsCell(i + 1);

                    // DO NOT trigger speaker mapping - just copy the actors
                });

                container.appendChild(copyBtn);
            }
        }

        // 3. Pills
        currentActors.forEach(actor => {
            const pill = document.createElement('span');
            pill.className = 'actor-pill';
            pill.textContent = actor;
            pill.title = 'Click to remove';
            
            pill.addEventListener('click', () => {
                const updatedActors = currentActors.filter(a => a !== actor);
                const newText = updatedActors.join(' ');
                
                row.Actors = newText;
                updateBackendMemory(i, 'Actors', newText);
                
                renderRowActorsCell(i);
                renderRowActorsCell(i + 1);
            });
            
            container.appendChild(pill);
        });
        
        tdActors.appendChild(container);
    }

    let saveTimeout;
    function updateBackendMemory(arrayIndex, field, value) {
        saveStatus.textContent = 'Saving...';
        saveStatus.style.color = 'var(--text-secondary)';
        saveSpinner.classList.remove('hidden');

        // Optional debounce
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            fetch('/api/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ arrayIndex, field, value, filename: currentFilename, secretCode: currentSecretCode })
            })
            .then(res => res.json())
            .then(data => {
                if(data.success) {
                    saveStatus.textContent = 'All changes saved';
                    saveStatus.style.color = 'var(--success-color)';
                } else {
                    throw new Error('Save failed');
                }
            })
            .catch(err => {
                console.error(err);
                saveStatus.textContent = 'Failed to save';
                saveStatus.style.color = '#ef4444';
            })
            .finally(() => {
                saveSpinner.classList.add('hidden');
            });
        }, 150);
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

            const ogText = clearAllBtn.textContent;
            clearAllBtn.textContent = 'Clearing...';
            clearAllBtn.disabled = true;
            saveStatus.textContent = 'Clearing all tags...';
            saveStatus.style.color = 'var(--text-secondary)';
            saveSpinner.classList.remove('hidden');

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
                globalRows.forEach((_, i) => renderRowActorsCell(i));
            }

            saveStatus.textContent = 'All tags cleared';
            saveStatus.style.color = 'var(--success-color)';
            saveSpinner.classList.add('hidden');
            clearAllBtn.textContent = ogText;
            clearAllBtn.disabled = false;
        });
    }

    if (pushBtn) {
        pushBtn.addEventListener('click', () => {
            if (!currentFilename) return alert('Please load a file first.');

            const ogText = pushBtn.textContent;
            pushBtn.textContent = 'Pushing to GitHub...';
            pushBtn.disabled = true;

            fetch('/api/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: currentFilename, secretCode: currentSecretCode })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    alert('Successfully pushed latest changes to GitHub!');
                } else {
                    alert('Failed to push: ' + (data.error || 'Unknown error'));
                }
            })
            .catch(err => {
                console.error(err);
                alert('Network error while pushing to GitHub.');
            })
            .finally(() => {
                pushBtn.textContent = ogText;
                pushBtn.disabled = false;
            });
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
    function addActorToRow(rowIndex, actorName) {
        const row = globalRows[rowIndex];
        const oldVal = row.Actors || '';
        const currentText = oldVal.trim();
        const newText = currentText ? `${currentText} #${actorName.trim()}` : `#${actorName.trim()}`;

        row.Actors = newText;
        updateBackendMemory(rowIndex, 'Actors', newText);

        renderRowActorsCell(rowIndex);
        renderRowActorsCell(rowIndex + 1);

        // Apply to all rows with same speaker (auto-fill same speakers)
        applySpeakerMapping(rowIndex);
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
            saveStatus.textContent = 'Reassigning speaker...';
            saveStatus.style.color = 'var(--text-secondary)';
            saveSpinner.classList.remove('hidden');

            await updateMultipleRows(rowsToUpdate, 'Actors');

            saveStatus.textContent = 'All changes saved';
            saveStatus.style.color = 'var(--success-color)';
            saveSpinner.classList.add('hidden');

            // Re-render all affected cells
            rowsToUpdate.forEach(i => renderRowActorsCell(i));
        }
    }
});
