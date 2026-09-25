import Swal from 'sweetalert2';

const base = {
  customClass: {
    popup: 'swal-popup',
    confirmButton: 'swal-btn-confirm',
    cancelButton: 'swal-btn-cancel',
    actions: 'swal-actions',
    title: 'swal-title',
    htmlContainer: 'swal-html',
  },
  buttonsStyling: false,
  reverseButtons: true,
  showCancelButton: true,
  cancelButtonText: 'Cancel',
};

const dangerBase = {
  ...base,
  customClass: { ...base.customClass, confirmButton: 'swal-btn-confirm swal-btn-confirm--danger' },
};

const warningBase = {
  ...base,
  customClass: { ...base.customClass, confirmButton: 'swal-btn-confirm swal-btn-confirm--warning' },
};

export const confirm = {
  delete: (opts = {}) =>
    Swal.fire({
      ...dangerBase,
      title: opts.title || 'Delete Record?',
      html: opts.text
        ? `<span>${opts.text}</span>`
        : 'This action <strong>cannot be undone</strong>. The record will be permanently removed.',
      icon: 'warning',
      confirmButtonText: opts.confirmText || 'Yes, Delete',
    }),

  create: (opts = {}) =>
    Swal.fire({
      ...base,
      title: opts.title || 'Create Record?',
      text: opts.text || 'You are about to create a new record. Do you want to continue?',
      icon: 'question',
      confirmButtonText: opts.confirmText || 'Yes, Create',
    }),

  save: (opts = {}) =>
    Swal.fire({
      ...base,
      title: opts.title || 'Save Changes?',
      text: opts.text || 'You are about to save changes to this record. Do you want to continue?',
      icon: 'question',
      confirmButtonText: opts.confirmText || 'Save',
    }),

  submit: (opts = {}) =>
    Swal.fire({
      ...base,
      title: opts.title || 'Submit for Review?',
      text: opts.text || 'Once submitted, this record will be sent for review and approval.',
      icon: 'info',
      confirmButtonText: opts.confirmText || 'Yes, Submit',
    }),

  approve: (opts = {}) =>
    Swal.fire({
      ...base,
      title: opts.title || 'Approve Record?',
      text: opts.text || 'Are you sure you want to approve this? This action will be permanently recorded.',
      icon: 'question',
      confirmButtonText: opts.confirmText || 'Yes, Approve',
    }),

  reject: (opts = {}) =>
    Swal.fire({
      ...dangerBase,
      title: opts.title || 'Reject Record?',
      text: opts.text || 'Are you sure you want to reject this record?',
      icon: 'warning',
      confirmButtonText: opts.confirmText || 'Yes, Reject',
    }),

  /*
   * Rejection that COLLECTS the reason, rather than asking for confirmation and leaving the reason to
   * be gathered somewhere else. The routes that return an expense or a liquidation require one, so a
   * dialog without an input can only produce a 422 the user cannot act on.
   *
   * Resolves like any other confirm; `result.value` carries the trimmed reason.
   */
  rejectWithReason: (opts = {}) =>
    Swal.fire({
      ...dangerBase,
      title: opts.title || 'Return this record?',
      html: opts.text ? `<span>${opts.text}</span>` : null,
      icon: 'warning',
      input: 'textarea',
      inputLabel: opts.inputLabel || 'Reason',
      inputPlaceholder: opts.placeholder || 'Say what needs to change before this can be approved…',
      inputAttributes: { 'aria-label': opts.inputLabel || 'Reason', maxlength: 500 },
      confirmButtonText: opts.confirmText || 'Return with this reason',
      // Validated here as well as on the server: catching it in the dialog keeps the text the user
      // already typed, where a round trip would discard it.
      inputValidator: (value) => (value && value.trim() ? undefined : 'A reason is required'),
      preConfirm: (value) => value.trim(),
    }),

  /*
   * Cancelling a programme is not an ordinary status change. It stops the work, and the other four
   * statuses describe progress that can be revised afterwards — so it gets the danger styling and
   * says plainly what it means, rather than the generic "Change status to X?".
   */
  cancelProgram: (opts = {}) =>
    Swal.fire({
      ...dangerBase,
      title: opts.title || 'Cancel this program?',
      html: opts.text
        ? `<span>${opts.text}</span>`
        : 'The program will be marked <strong>cancelled</strong>. Participants and reports keep it on record.',
      icon: 'warning',
      confirmButtonText: opts.confirmText || 'Yes, cancel it',
      cancelButtonText: opts.cancelText || 'Keep the program',
    }),

  archive: (opts = {}) =>
    Swal.fire({
      ...warningBase,
      title: opts.title || 'Archive Document?',
      text: opts.text || 'This document will be archived and removed from the active list.',
      icon: 'warning',
      confirmButtonText: opts.confirmText || 'Yes, Archive',
    }),

  upload: (opts = {}) =>
    Swal.fire({
      ...base,
      title: opts.title || 'Upload Document?',
      text: opts.text || 'You are about to upload this document to the system.',
      icon: 'question',
      confirmButtonText: opts.confirmText || 'Yes, Upload',
    }),

  financial: (opts = {}) =>
    Swal.fire({
      ...warningBase,
      title: opts.title || 'Confirm Financial Action?',
      html: opts.text
        ? `<span>${opts.text}</span>`
        : 'This is a <strong>financial action</strong> that will affect fund records. Please confirm carefully.',
      icon: 'warning',
      confirmButtonText: opts.confirmText || 'Confirm',
    }),

  statusChange: (opts = {}) =>
    Swal.fire({
      ...base,
      title: opts.title || 'Change Status?',
      text: opts.text || 'You are about to change the status of this record.',
      icon: 'question',
      confirmButtonText: opts.confirmText || 'Yes, Change',
    }),

  logout: () =>
    Swal.fire({
      ...dangerBase,
      title: 'Confirm Logout',
      text: 'Are you sure you want to log out of the system?',
      icon: 'question',
      confirmButtonText: 'Yes, Logout',
    }),

  register: (opts = {}) =>
    Swal.fire({
      ...base,
      title: opts.title || 'Register Member?',
      text: opts.text || 'Are you sure you want to register this member?',
      icon: 'question',
      confirmButtonText: opts.confirmText || 'Yes, Register',
    }),

  password: (opts = {}) =>
    Swal.fire({
      ...base,
      title: opts.title || 'Update Password?',
      text: opts.text || 'You are about to change your account password.',
      icon: 'question',
      confirmButtonText: opts.confirmText || 'Yes, Update',
    }),
};
