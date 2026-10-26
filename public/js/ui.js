// Reusable UI helpers, Accessible Modals, Toast Alerts, and Confirmation Dialogs
import { $, escapeHtml } from './api.js';

export function toast(message) {
    const box = $('toast');
    if (!box) return;
    box.textContent = message;
    box.classList.add('show');
    clearTimeout(box._timer);
    box._timer = setTimeout(() => box.classList.remove('show'), 3500);
}

export function openModal(modalId) {
    const el = typeof modalId === 'string' ? $(modalId) : modalId;
    if (el) {
        el.classList.add('open');
        // Auto focus first input if available
        const input = el.querySelector('input:not([type="hidden"]), select, textarea');
        if (input) setTimeout(() => input.focus(), 80);
    }
}

export function closeModal(modalId) {
    const el = typeof modalId === 'string' ? $(modalId) : modalId;
    if (el) {
        el.classList.remove('open');
    }
}

/**
 * Modern Contextual Confirmation Dialog (replaces window.confirm)
 */
let pendingConfirmCallback = null;

export function showConfirmDialog({
    title = 'Confirm Action',
    message = 'Are you sure you want to proceed?',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    danger = false,
    onConfirm
}) {
    const modal = $('confirmModal');
    if (!modal) {
        // Fallback if modal not present
        if (window.confirm(message)) {
            if (onConfirm) onConfirm();
        }
        return;
    }

    $('confirmTitle').textContent = title;
    $('confirmMessage').innerHTML = message;
    
    const confirmBtn = $('confirmBtnAction');
    confirmBtn.textContent = confirmText;
    if (danger) {
        confirmBtn.className = 'login btn-danger';
    } else {
        confirmBtn.className = 'login submitlogin';
    }

    const cancelBtn = $('confirmBtnCancel');
    cancelBtn.textContent = cancelText;

    pendingConfirmCallback = onConfirm;
    openModal(modal);
}

export function initConfirmDialog() {
    const confirmBtn = $('confirmBtnAction');
    const cancelBtn = $('confirmBtnCancel');
    const closeBtn = $('confirmClose');

    if (confirmBtn) {
        confirmBtn.onclick = async () => {
            closeModal('confirmModal');
            if (pendingConfirmCallback) {
                const cb = pendingConfirmCallback;
                pendingConfirmCallback = null;
                await cb();
            }
        };
    }
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            pendingConfirmCallback = null;
            closeModal('confirmModal');
        };
    }
    if (closeBtn) {
        closeBtn.onclick = () => {
            pendingConfirmCallback = null;
            closeModal('confirmModal');
        };
    }
}

/**
 * Maps FastAPI / Pydantic 422 error structures directly to DOM inputs
 */
export function renderFormErrors(formElement, errorDetail) {
    clearFormErrors(formElement);
    if (!formElement || !errorDetail) return;

    if (Array.isArray(errorDetail)) {
        errorDetail.forEach(err => {
            const loc = err.loc || [];
            const fieldName = loc[loc.length - 1];
            const input = formElement.querySelector(`[name="${fieldName}"], #${fieldName}`);
            if (input) {
                input.classList.add('has-error');
                const errLabel = document.createElement('span');
                errLabel.className = 'field-error-msg';
                errLabel.textContent = err.msg || 'Invalid value';
                input.parentNode.appendChild(errLabel);
            }
        });
    } else if (typeof errorDetail === 'string') {
        const topErr = formElement.querySelector('.formerror');
        if (topErr) topErr.textContent = errorDetail;
    }
}

export function clearFormErrors(formElement) {
    if (!formElement) return;
    formElement.querySelectorAll('.has-error').forEach(el => el.classList.remove('has-error'));
    formElement.querySelectorAll('.field-error-msg').forEach(el => el.remove());
    const topErr = formElement.querySelector('.formerror');
    if (topErr) topErr.textContent = '';
}

// Global Keyboard & Backdrop Listeners
export function initGlobalModalListeners() {
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modalback.open').forEach(m => m.classList.remove('open'));
        }
    });

    document.querySelectorAll('.modalback').forEach(modal => {
        modal.addEventListener('click', e => {
            if (e.target === modal) {
                modal.classList.remove('open');
            }
        });
    });
}
