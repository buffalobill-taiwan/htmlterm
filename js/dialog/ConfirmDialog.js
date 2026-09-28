import { SelectDialog } from './SelectDialog.js';

export class ConfirmDialog extends SelectDialog {
    constructor(term, opts) {
        super(term, {
            ...opts,
            width: opts.width || 36,
            options: [opts.confirmLabel || 'Yes', opts.cancelLabel || 'No'],
            onSelect: index => {
                if (index === 0) opts.onConfirm?.();
                else opts.onCancel?.();
            },
        });
    }
}
