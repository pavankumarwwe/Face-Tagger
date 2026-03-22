document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('table-body');
    const saveStatus = document.getElementById('save-status');
    const saveSpinner = document.getElementById('save-spinner');
    const fileSelect = document.getElementById('file-select');
    const loadBtn = document.getElementById('load-file-btn');
    const pageTitle = document.getElementById('page-title');
    const pushBtn = document.getElementById('push-btn');
    const openMovieBtn = document.getElementById('open-movie-btn');
    const openMovieHelp = document.getElementById('open-movie-help');

    let currentSecretCode = '';
    let globalRows = [];
    let globalCastOptions = [];
    let currentFilename = '';

    function extractActors(str) {
        if (!str) return [];
        return str.split(/(?=#)/).map(s => s.trim()).filter(Boolean);
    }
    
    function updateYoutubeLink(url) {
        if (url) {
            openMovieBtn.href = url;
            openMovieBtn.style.display = 'inline-flex';
            openMovieHelp.style.display = 'none';
        } else {
            openMovieBtn.style.display = 'none';
            openMovieHelp.style.display = 'inline-block';
        }
    }

    fetch('/api/files')
        .then(res => res.json())
        .then(data => {
            if (data.files && data.files.length > 0) {
                fileSelect.innerHTML = data.files.map(f => `<option value="${f}">${f}</option>`).join('');
                if (data.currentFile) fileSelect.value = data.currentFile;
            }
        });

    loadBtn.addEventListener('click', () => {
        const filename = fileSelect.value;
        if (!filename) return;
        
        const code = prompt(`Please enter the secret code for ${filename}:`);
        if (code === null) return;
        
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
                alert(data.error);
                return;
            }
            currentSecretCode = code;
            currentFilename = data.currentFile;
            pageTitle.textContent = `CSV Manager - ${data.currentFile}`;
            globalRows = data.rows;
            globalCastOptions = data.castOptions;
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
                <td class="readonly-cell">${escapeHtml(row.original_telugu || '')}</td>
                <td class="readonly-cell">${escapeHtml(row.transliteration || '')}</td>
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
        const sortedOptions = [...globalCastOptions].sort((a, b) => a.localeCompare(b));
        
        // 1. Dropdown
        const select = document.createElement('select');
        const optionsHtml = ['<option value="">+ Add Cast</option>'];
        const currentCheck = currentActors.map(a => a.substring(1)); // Remove '#'
        
        sortedOptions.forEach(cast => {
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
        });
        
        if (optionsHtml.length > 1) {
            container.appendChild(select);
        }

        // 2. Copy Previous Button
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
});
