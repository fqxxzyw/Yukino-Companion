import React from 'react';
import {Trash2, Upload} from 'lucide-react';

export default function ConfirmDialog({title, description, confirmLabel = '确认', destructive = false, onConfirm, onCancel}) {
  return <div className="modal-backdrop confirm-backdrop" onMouseDown={event => {if (event.target === event.currentTarget) onCancel();}}>
    <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
      <div className={`confirm-symbol ${destructive ? 'destructive' : ''}`}>{destructive ? <Trash2 size={23}/> : <Upload size={23}/>}</div>
      <h2 id="confirm-title">{title}</h2><p id="confirm-description">{description}</p>
      <div className="button-row"><button type="button" className="secondary" onClick={onCancel}>取消</button>
        <button type="button" className={destructive ? 'primary danger-button' : 'primary'} onClick={onConfirm}>{confirmLabel}</button></div>
    </section>
  </div>;
}
