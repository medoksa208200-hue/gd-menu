'use client';
import {Check, Circle} from 'lucide-react';
import {passwordChecks,type PasswordCheckKey} from '@/supabase/functions/_shared/password-policy.mjs';
import {useUI} from './platform';
const labels:[PasswordCheckKey,string,string][]=[
 ['length','8 أحرف على الأقل (بحد أقصى 128)','8–128 characters'],
 ['uppercase','حرف إنجليزي كبير واحد على الأقل (A–Z)','At least one uppercase letter (A–Z)'],
 ['lowercase','حرف إنجليزي صغير واحد على الأقل (a–z)','At least one lowercase letter (a–z)'],
 ['number','رقم واحد على الأقل (0–9)','At least one number (0–9)'],
 ['special','رمز خاص مثل ! @ # $','A special character such as ! @ # $'],
];
export default function PasswordRequirements({value}:{value:string}){const {t}=useUI();const checks=passwordChecks(value);return <ul className="password-requirements" aria-label={t('شروط كلمة المرور','Password requirements')} aria-live="polite">{labels.map(([key,ar,en])=><li key={key} className={checks[key]?'passed':'pending'}>{checks[key]?<Check size={15} aria-hidden="true"/>:<Circle size={13} aria-hidden="true"/>}<span>{t(ar,en)}</span><span className="sr-only">{t(checks[key]?'تم تحقيقه':'لم يتحقق بعد',checks[key]?'Met':'Not yet met')}</span></li>)}</ul>}
