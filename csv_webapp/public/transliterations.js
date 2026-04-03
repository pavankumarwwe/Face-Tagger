document.addEventListener('DOMContentLoaded', async () => {
    const akashamPosterSrc = 'akasham-title-shot.jpg';
    const akashamInputSrc = 'akasham-input-shot.jpg';
    const tableBody = document.getElementById('table-body');
    const saveStatus = document.getElementById('save-status');
    const saveSpinner = document.getElementById('save-spinner');
    const saveBtn = document.getElementById('save-btn');
    const reloadBtn = document.getElementById('reload-btn');
    const markCompleteBtn = document.getElementById('mark-complete-btn');
    const exportBtn = document.getElementById('export-btn');
    const reopenBtn = document.getElementById('reopen-btn');
    const rowCount = document.getElementById('row-count');

    let secretCode = '';
    let allRows = [];
    let filteredRows = [];
    let hasUnsavedChanges = false;
    let currentStatus = 'Not Started';
    let isLoaded = false;
    function setStatus(message, colorVar = '--text-secondary') {
        saveStatus.textContent = message;
        saveStatus.style.color = `var(${colorVar})`;
    }

    function setBusy(message) {
        saveSpinner.classList.remove('hidden');
        setStatus(message);
    }

    function clearBusy() {
        saveSpinner.classList.add('hidden');
    }

    function escapeHtml(value) {
        return (value || '')
            .toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function updateControls(enabled) {
        reloadBtn.disabled = !enabled;
    }

    function setEditingLocked(locked) {
        if (!tableBody) return;
        tableBody.style.pointerEvents = locked ? 'none' : '';
        tableBody.style.opacity = locked ? '0.6' : '';
        saveBtn.disabled = locked || !isLoaded;
    }

    function updateActionVisibility() {
        const isComplete = isLoaded && currentStatus === 'Complete';
        markCompleteBtn.style.display = isLoaded && !isComplete ? 'inline-flex' : 'none';
        saveBtn.style.display = isLoaded && !isComplete ? 'inline-flex' : 'inline-flex';
        exportBtn.style.display = isComplete ? 'inline-flex' : 'none';
        reopenBtn.style.display = isComplete ? 'inline-flex' : 'none';
        saveBtn.disabled = !isLoaded || isComplete;
        markCompleteBtn.disabled = !isLoaded || isComplete;
        setEditingLocked(isComplete);
    }

    function setStatusState(status) {
        currentStatus = status || 'Not Started';
        updateActionVisibility();
    }

    function updateRowCount() {
        rowCount.textContent = `${filteredRows.length} of ${allRows.length} rows`;
    }

    function setDirtyStatus(message = 'Unsaved changes') {
        hasUnsavedChanges = true;
        setStatus(message);
    }

    function setSavedStatus(message = 'All changes saved') {
        hasUnsavedChanges = false;
        setStatus(message, '--success-color');
    }

    async function confirmDiscardChanges(actionLabel) {
        if (!hasUnsavedChanges) return true;
        return window.confirmWithModal({
            title: 'Unsaved Changes',
            message:
                `You have unsaved changes.\n\n` +
                `If you continue to ${actionLabel}, your current edits may be lost.`,
            confirmText: 'Continue',
            cancelText: 'Stay'
        });
    }

    async function readJsonResponse(response) {
        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();

        if (contentType.includes('application/json')) {
            return JSON.parse(text);
        }

        throw new Error(text.trim() || `Unexpected response (${response.status})`);
    }

    function renderTable() {
        tableBody.innerHTML = filteredRows.map((row) => {
            const actualIndex = row.__rowIndex;
            const displayIndex = row.index || String(actualIndex + 1);

            return `
            <article class="transliteration-card" data-row-index="${actualIndex}">
                <div class="transliteration-card-header">
                    <span class="transliteration-index-badge">#${escapeHtml(displayIndex)}</span>
                </div>
                <div class="transliteration-field">
                    <span class="transliteration-field-label">English</span>
                    <div class="transliteration-english-row">
                        <div class="readonly-cell transliteration-english-cell">${escapeHtml(row.english)}</div>
                    </div>
                </div>
                <div class="transliteration-field">
                    <span class="transliteration-field-label">CMU</span>
                    <div class="transliteration-input-wrap">
                        <input
                            class="transliteration-input"
                            data-row-index="${actualIndex}"
                            data-field="cmu"
                            type="text"
                            value="${escapeHtml(row.cmu)}"
                        >
                        <button
                            class="transliteration-clear-btn"
                            data-row-index="${actualIndex}"
                            data-field="cmu"
                            type="button"
                            title="Clear CMU text"
                            aria-label="Clear CMU text"
                        >
                            x
                        </button>
                    </div>
                </div>
                <div class="transliteration-field">
                    <span class="transliteration-field-label">Google</span>
                    <div class="transliteration-input-wrap">
                        <input
                            class="transliteration-input"
                            data-row-index="${actualIndex}"
                            data-field="google"
                            type="text"
                            value="${escapeHtml(row.google)}"
                        >
                        <button
                            class="transliteration-clear-btn"
                            data-row-index="${actualIndex}"
                            data-field="google"
                            type="button"
                            title="Clear Google text"
                            aria-label="Clear Google text"
                        >
                            x
                        </button>
                    </div>
                </div>
            </article>
        `;
        }).join('');

        updateRowCount();

        tableBody.querySelectorAll('.transliteration-input').forEach((input) => {
            input.addEventListener('input', (event) => {
                const rowIndex = Number.parseInt(event.target.dataset.rowIndex || '', 10);
                const field = event.target.dataset.field;
                const row = allRows[rowIndex];
                if (!row || (field !== 'cmu' && field !== 'google')) return;

                row[field] = event.target.value;
                setDirtyStatus();
            });
        });

        tableBody.querySelectorAll('.transliteration-clear-btn').forEach((button) => {
            button.addEventListener('click', (event) => {
                const rowIndex = Number.parseInt(event.currentTarget.dataset.rowIndex || '', 10);
                const field = event.currentTarget.dataset.field;
                const row = allRows[rowIndex];
                if (!row || (field !== 'cmu' && field !== 'google')) return;

                row[field] = '';
                const input = tableBody.querySelector(
                    `.transliteration-input[data-row-index="${rowIndex}"][data-field="${field}"]`
                );
                if (input) {
                    input.value = '';
                    input.focus();
                }
                setDirtyStatus();
            });
        });
    }

    async function loadRows() {
        if (!secretCode) return;

        setBusy('Unlocking editor...');
        updateControls(false);

        try {
            const response = await fetch('/api/transliterations/load', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ secretCode })
            });
            const data = await readJsonResponse(response);

            if (!response.ok || !data.success) {
                let message = data.error || 'Failed to load transliterations.';
                if (data.attemptsLeft !== undefined && data.attemptsLeft > 0) {
                    message += `\n\nAttempts remaining: ${data.attemptsLeft}`;
                }
                throw new Error(message);
            }

            allRows = (Array.isArray(data.rows) ? data.rows : []).map((row, index) => ({
                ...row,
                index: (row?.index || index + 1).toString(),
                __rowIndex: index
            }));
            filteredRows = [...allRows];
            isLoaded = true;
            renderTable();
            updateControls(true);
            setStatusState(data.status || 'Not Started');
            if ((data.status || 'Not Started') === 'Complete') {
                setStatus('CSV is complete', '--success-color');
            } else {
                setSavedStatus('Editor unlocked');
            }
        } catch (error) {
            isLoaded = false;
            updateActionVisibility();
            setStatus('Access denied', '--danger-color');
            alert(error.message || 'Failed to load transliterations.');
        } finally {
            clearBusy();
        }
    }

    async function saveRows() {
        if (!secretCode) return;

        setBusy('Saving CSV...');
        saveBtn.disabled = true;

        try {
            const response = await fetch('/api/transliterations/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ secretCode, rows: allRows })
            });
            const data = await readJsonResponse(response);

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to save transliterations.');
            }

            setSavedStatus(`Saved ${data.rowsSaved} rows`);
        } catch (error) {
            setStatus('Save failed', '--danger-color');
            alert(error.message || 'Failed to save transliterations.');
            throw error;
        } finally {
            clearBusy();
            saveBtn.disabled = false;
        }
    }

    window.addEventListener('beforeunload', (event) => {
        if (!hasUnsavedChanges) return;
        event.preventDefault();
        event.returnValue = '';
    });

    reloadBtn.addEventListener('click', async () => {
        if (!await confirmDiscardChanges('reload the CSV')) return;
        await loadRows();
    });

    saveBtn.addEventListener('click', async () => {
        await saveRows();
    });

    markCompleteBtn.addEventListener('click', async () => {
        if (!isLoaded) return;

        const confirmed = await window.confirmWithModal({
            title: 'Mark Transliteration CSV Complete?',
            message:
                'This will lock editing until it is reopened with the universal password.',
            confirmText: 'Mark Complete',
            cancelText: 'Cancel'
        });
        if (!confirmed) return;

        const originalText = markCompleteBtn.textContent;
        markCompleteBtn.textContent = 'Completing...';
        markCompleteBtn.disabled = true;

        try {
            if (hasUnsavedChanges) {
                await saveRows();
            }

            const response = await fetch('/api/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: 'telugu_transliterations.csv',
                    status: 'Complete'
                })
            });
            const data = await readJsonResponse(response);
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to mark CSV complete');
            }

            setStatusState('Complete');
            setSavedStatus('CSV marked complete');
            alert('Transliterations CSV marked complete. You can export it now.');
        } catch (error) {
            setStatus('Complete failed', '--danger-color');
            alert(error.message || 'Failed to mark transliterations CSV complete.');
        } finally {
            markCompleteBtn.textContent = originalText;
            updateActionVisibility();
            clearBusy();
        }
    });

    exportBtn.addEventListener('click', () => {
        window.location.href = '/api/transliterations/export';
    });

    reopenBtn.addEventListener('click', async () => {
        if (!isLoaded) return;

        const code = await window.promptForPassword({
            title: 'Akasham Yerraga Undhi',
            message: 'Akasham Yerraga Undhi',
            mediaSrc: akashamPosterSrc,
            mediaAlt: 'Akasham Yerraga Undhi',
            inputMediaSrc: akashamInputSrc,
            inputMediaAlt: 'Akasham Yerraga Undhi',
            placeholder: 'Universal password',
            confirmText: 'Reopen'
        });
        if (code === null) return;

        const originalText = reopenBtn.textContent;
        reopenBtn.textContent = 'Reopening...';
        reopenBtn.disabled = true;

        try {
            const response = await fetch('/api/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: 'telugu_transliterations.csv',
                    status: 'In Progress',
                    secretCode: code
                })
            });
            const data = await readJsonResponse(response);
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to reopen CSV');
            }

            secretCode = code;
            setStatusState('In Progress');
            setSavedStatus('CSV reopened for editing');
            alert('Transliterations CSV reopened. You can edit it again now.');
        } catch (error) {
            setStatus('Reopen failed', '--danger-color');
            alert(error.message || 'Failed to reopen transliterations CSV.');
        } finally {
            reopenBtn.textContent = originalText;
            updateActionVisibility();
        }
    });

    secretCode = await window.promptForPassword({
        title: 'Akasham Yerraga Undhi',
        message: 'Akasham Yerraga Undhi',
        mediaSrc: akashamPosterSrc,
        mediaAlt: 'Akasham Yerraga Undhi',
        inputMediaSrc: akashamInputSrc,
        inputMediaAlt: 'Akasham Yerraga Undhi',
        placeholder: 'Universal password',
        confirmText: 'Unlock'
    }) || '';
    if (!secretCode) {
        setStatus('Access cancelled', '--danger-color');
        return;
    }

    updateActionVisibility();
    loadRows();
});
