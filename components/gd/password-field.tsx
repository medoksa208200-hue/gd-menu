'use client';
import {useId,useState,type InputHTMLAttributes,type ReactNode} from 'react';
import {Eye,EyeOff} from 'lucide-react';
import {useUI} from './platform';
type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'children'> & {label:ReactNode;children?:ReactNode};
export default function PasswordField({label,children,id:providedId,...props}:Props){
 const {t}=useUI();const generatedId=useId();const id=providedId||generatedId;const [visible,setVisible]=useState(false);
 const action=visible?t('إخفاء كلمة المرور','Hide password'):t('إظهار كلمة المرور','Show password');
 return <div className="password-field"><label htmlFor={id}>{label}</label><div className="password-input-wrap" dir={props.dir}><input {...props} id={id} type={visible?'text':'password'}/><button type="button" className="password-toggle" aria-label={action} title={action} aria-controls={id} aria-pressed={visible} disabled={props.disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>setVisible(show=>!show)}>{visible?<EyeOff size={19} aria-hidden="true"/>:<Eye size={19} aria-hidden="true"/>}</button></div>{children}</div>
}
