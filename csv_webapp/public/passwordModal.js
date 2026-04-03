(() => {
    function ensurePasswordModal() {
        let modal = document.getElementById('password-prompt-modal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'password-prompt-modal';
        modal.className = 'actor-modal password-modal-overlay';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content password-modal-content" role="dialog" aria-modal="true" aria-labelledby="password-modal-title">
                <div class="password-modal-toast" aria-live="polite">
                    <div class="password-modal-toast-copy">
                        <p class="password-modal-toast-primary"></p>
                        <p class="password-modal-toast-secondary"></p>
                    </div>
                    <button class="password-modal-toast-close" type="button" aria-label="Dismiss message">&times;</button>
                </div>
                <div class="modal-header">
                    <h3 id="password-modal-title">Enter Password</h3>
                    <button class="modal-close password-modal-close" type="button" aria-label="Close password dialog">&times;</button>
                </div>
                <div class="modal-body password-modal-body">
                    <div class="password-modal-intro">
                        <div class="password-modal-media-wrap">
                            <img class="password-modal-media" alt="">
                        </div>
                        <p class="password-modal-message"></p>
                    </div>
                    <form class="password-modal-form">
                        <div class="password-input-row">
                            <div class="password-input-media-wrap">
                                <img class="password-input-media" alt="">
                            </div>
                            <div class="password-input-group">
                                <input
                                    id="password-modal-input"
                                    class="modal-search password-modal-input"
                                    type="password"
                                    autocomplete="current-password"
                                    spellcheck="false"
                                    placeholder="Enter password"
                                >
                                <button class="password-toggle-btn" type="button" aria-label="Show password" aria-pressed="false">
                                    <svg class="password-icon-eye" viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M1.5 12s3.8-6.5 10.5-6.5S22.5 12 22.5 12s-3.8 6.5-10.5 6.5S1.5 12 1.5 12Z"></path>
                                        <circle cx="12" cy="12" r="3.25"></circle>
                                    </svg>
                                    <svg class="password-icon-eye-off" viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M3 3l18 18"></path>
                                        <path d="M10.6 5.2A11.3 11.3 0 0 1 12 5.1c6.7 0 10.5 6.4 10.5 6.4a18.2 18.2 0 0 1-3.6 4.3"></path>
                                        <path d="M6.5 6.5A18.7 18.7 0 0 0 1.5 12s3.8 6.5 10.5 6.5c1.9 0 3.5-.5 4.9-1.2"></path>
                                        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <div class="password-modal-actions">
                            <button class="btn btn-secondary password-cancel-btn" type="button">Cancel</button>
                            <button class="btn password-submit-btn" type="submit">Continue</button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        return modal;
    }

    window.promptForPassword = function promptForPassword(options = {}) {
        const modal = ensurePasswordModal();
        const titleEl = modal.querySelector('#password-modal-title');
        const messageEl = modal.querySelector('.password-modal-message');
        const mediaWrapEl = modal.querySelector('.password-modal-media-wrap');
        const mediaEl = modal.querySelector('.password-modal-media');
        const inputRowEl = modal.querySelector('.password-input-row');
        const inputMediaWrapEl = modal.querySelector('.password-input-media-wrap');
        const inputMediaEl = modal.querySelector('.password-input-media');
        const toastEl = modal.querySelector('.password-modal-toast');
        const toastPrimaryEl = modal.querySelector('.password-modal-toast-primary');
        const toastSecondaryEl = modal.querySelector('.password-modal-toast-secondary');
        const toastCloseBtn = modal.querySelector('.password-modal-toast-close');
        const inputEl = modal.querySelector('#password-modal-input');
        const closeBtn = modal.querySelector('.password-modal-close');
        const cancelBtn = modal.querySelector('.password-cancel-btn');
        const submitBtn = modal.querySelector('.password-submit-btn');
        const formEl = modal.querySelector('.password-modal-form');
        const toggleBtn = modal.querySelector('.password-toggle-btn');

        titleEl.textContent = options.title || 'Enter Password';
        modal.classList.remove('confirm-modal-mode');
        messageEl.textContent = options.message || 'Please enter your password.';
        mediaEl.src = options.mediaSrc || '';
        mediaEl.alt = options.mediaAlt || '';
        mediaWrapEl.classList.toggle('is-visible', Boolean(options.mediaSrc));
        inputMediaEl.src = options.inputMediaSrc || '';
        inputMediaEl.alt = options.inputMediaAlt || '';
        inputMediaWrapEl.classList.toggle('is-visible', Boolean(options.inputMediaSrc));
        messageEl.classList.toggle('is-hidden', !options.message);
        toastPrimaryEl.textContent = options.feedbackPrimary || options.feedback || '';
        toastSecondaryEl.textContent = options.feedbackSecondary || '';
        toastPrimaryEl.classList.toggle('is-error', options.feedbackType === 'error');
        toastEl.classList.toggle(
            'is-visible',
            Boolean((options.feedbackPrimary || options.feedback || '').trim() || (options.feedbackSecondary || '').trim())
        );
        inputEl.value = options.defaultValue || '';
        inputEl.type = 'password';
        inputEl.placeholder = options.placeholder || 'Enter password';
        submitBtn.textContent = options.confirmText || 'Continue';

        const updateToggleState = () => {
            const isVisible = inputEl.type === 'text';
            toggleBtn.setAttribute('aria-label', isVisible ? 'Hide password' : 'Show password');
            toggleBtn.setAttribute('aria-pressed', String(isVisible));
            toggleBtn.classList.toggle('is-visible', isVisible);
        };

        updateToggleState();
        modal.style.display = 'flex';

        return new Promise((resolve) => {
            let settled = false;

            const cleanup = () => {
                document.removeEventListener('keydown', handleKeydown);
                modal.removeEventListener('click', handleBackdropClick);
                closeBtn.removeEventListener('click', handleCancel);
                cancelBtn.removeEventListener('click', handleCancel);
                toastCloseBtn.removeEventListener('click', handleDismissToast);
                toggleBtn.removeEventListener('click', handleToggle);
                formEl.removeEventListener('submit', handleSubmit);
                modal.style.display = 'none';
            };

            const finish = (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };

            const handleCancel = () => finish(null);

            const handleDismissToast = () => {
                toastEl.classList.remove('is-visible');
            };

            const handleToggle = () => {
                inputEl.type = inputEl.type === 'password' ? 'text' : 'password';
                updateToggleState();
                inputEl.focus({ preventScroll: true });
                const caretPosition = inputEl.value.length;
                inputEl.setSelectionRange(caretPosition, caretPosition);
            };

            const handleSubmit = (event) => {
                event.preventDefault();
                finish(inputEl.value);
            };

            const handleBackdropClick = (event) => {
                if (event.target === modal) {
                    finish(null);
                }
            };

            const handleKeydown = (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    finish(null);
                }
            };

            document.addEventListener('keydown', handleKeydown);
            modal.addEventListener('click', handleBackdropClick);
            closeBtn.addEventListener('click', handleCancel);
            cancelBtn.addEventListener('click', handleCancel);
            toastCloseBtn.addEventListener('click', handleDismissToast);
            toggleBtn.addEventListener('click', handleToggle);
            formEl.addEventListener('submit', handleSubmit);

            setTimeout(() => {
                inputEl.focus();
                inputEl.select();
            }, 0);
        });
    };

    window.confirmWithModal = function confirmWithModal(options = {}) {
        const modal = ensurePasswordModal();
        const titleEl = modal.querySelector('#password-modal-title');
        const messageEl = modal.querySelector('.password-modal-message');
        const mediaWrapEl = modal.querySelector('.password-modal-media-wrap');
        const inputRowEl = modal.querySelector('.password-input-row');
        const toastEl = modal.querySelector('.password-modal-toast');
        const toastPrimaryEl = modal.querySelector('.password-modal-toast-primary');
        const toastSecondaryEl = modal.querySelector('.password-modal-toast-secondary');
        const inputGroup = modal.querySelector('.password-input-group');
        const inputEl = modal.querySelector('#password-modal-input');
        const closeBtn = modal.querySelector('.password-modal-close');
        const cancelBtn = modal.querySelector('.password-cancel-btn');
        const submitBtn = modal.querySelector('.password-submit-btn');
        const formEl = modal.querySelector('.password-modal-form');
        const toggleBtn = modal.querySelector('.password-toggle-btn');

        titleEl.textContent = options.title || 'Please Confirm';
        modal.classList.add('confirm-modal-mode');
        messageEl.textContent = options.message || 'Are you sure you want to continue?';
        messageEl.classList.toggle('is-hidden', !options.message);
        mediaWrapEl.classList.remove('is-visible');
        inputRowEl.style.display = 'none';
        toastPrimaryEl.textContent = options.feedbackPrimary || options.feedback || '';
        toastSecondaryEl.textContent = options.feedbackSecondary || '';
        toastPrimaryEl.classList.toggle('is-error', options.feedbackType === 'error');
        toastEl.classList.toggle(
            'is-visible',
            Boolean((options.feedbackPrimary || options.feedback || '').trim() || (options.feedbackSecondary || '').trim())
        );
        inputGroup.style.display = 'none';
        cancelBtn.textContent = options.cancelText || 'Cancel';
        submitBtn.textContent = options.confirmText || 'Continue';
        submitBtn.classList.toggle('btn-danger-outline', options.confirmStyle === 'danger');
        submitBtn.classList.toggle('btn-warning', options.confirmStyle === 'warning');
        modal.style.display = 'flex';

        return new Promise((resolve) => {
            let settled = false;

            const cleanup = () => {
                document.removeEventListener('keydown', handleKeydown);
                modal.removeEventListener('click', handleBackdropClick);
                closeBtn.removeEventListener('click', handleCancel);
                cancelBtn.removeEventListener('click', handleCancel);
                formEl.removeEventListener('submit', handleSubmit);
                inputRowEl.style.display = '';
                inputGroup.style.display = '';
                cancelBtn.textContent = 'Cancel';
                submitBtn.textContent = 'Continue';
                submitBtn.classList.remove('btn-danger-outline', 'btn-warning');
                modal.classList.remove('confirm-modal-mode');
                modal.style.display = 'none';
            };

            const finish = (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };

            const handleCancel = () => finish(false);

            const handleSubmit = (event) => {
                event.preventDefault();
                finish(true);
            };

            const handleBackdropClick = (event) => {
                if (event.target === modal) {
                    finish(false);
                }
            };

            const handleKeydown = (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    finish(false);
                }
            };

            document.addEventListener('keydown', handleKeydown);
            modal.addEventListener('click', handleBackdropClick);
            closeBtn.addEventListener('click', handleCancel);
            cancelBtn.addEventListener('click', handleCancel);
            formEl.addEventListener('submit', handleSubmit);

            setTimeout(() => submitBtn.focus(), 0);
        });
    };
})();
