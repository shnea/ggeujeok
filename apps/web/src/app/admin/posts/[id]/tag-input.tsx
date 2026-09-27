'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';

const tagKey = (name: string) => name.trim().normalize('NFC').toLocaleLowerCase('und');

export function TagInput({ value, onChange, disabled }: {
  value: string[]; onChange: (tags: string[]) => void; disabled: boolean;
}) {
  const id = useId(), input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState(-1);
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState<{ q: string; names: string[]; state: 'loading' | 'ready' | 'error' }>({ q: '', names: [], state: 'ready' });
  const q = text.trim().normalize('NFC');
  const atLimit = value.length >= 20;
  const visible = open && !disabled && !atLimit && !composing && Boolean(q);
  const names = search.q === q ? search.names.filter(name => !value.some(tag => tagKey(tag) === tagKey(name))) : [];
  const expanded = visible && names.length > 0;

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setSearch({ q, names: [], state: 'loading' });
    const timer = setTimeout(() => {
      api<{ name: string }[]>(`/api/admin/tags?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then(rows => { if (!controller.signal.aborted) setSearch({ q, names: rows.map(row => row.name), state: 'ready' }); })
        .catch(() => { if (!controller.signal.aborted) setSearch({ q, names: [], state: 'error' }); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q, visible, retry]);

  useEffect(() => {
    if (expanded && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, expanded, id]);

  function add(raw: string) {
    const name = raw.trim().normalize('NFC');
    if (disabled || !name) return;
    if (value.some(tag => tagKey(tag) === tagKey(name))) { setMessage('이미 추가한 태그입니다.'); return; }
    if (atLimit) { setMessage('태그는 20개까지 추가할 수 있습니다.'); return; }
    onChange([...value, name]);
    setText(''); setActive(-1); setOpen(false); setMessage(`${name} 태그를 추가했습니다.`);
    input.current?.focus();
  }

  return <div className="tag-input">
    <label htmlFor={id}>태그 <span className="optional">{value.length}/20</span></label>
    <div className="tag-entry"><input ref={input} id={id} role="combobox" aria-autocomplete="list" autoComplete="off"
      aria-expanded={expanded} aria-controls={expanded ? `${id}-options` : undefined}
      aria-activedescendant={expanded && names[active] ? `${id}-option-${active}` : undefined} aria-describedby={`${id}-help`}
      disabled={disabled || atLimit} value={text} maxLength={80} placeholder="태그 검색 또는 새로 입력"
      onFocus={() => setOpen(true)} onBlur={() => { setOpen(false); setActive(-1); }}
      onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
      onChange={event => { setText(event.target.value); setActive(-1); setOpen(true); setMessage(''); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || composing || event.keyCode === 229) return;
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setActive(-1); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          setActive(event.key === 'ArrowDown' ? Math.min(active + 1, names.length - 1) : active <= 0 ? names.length - 1 : active - 1);
        }
        if (event.key === 'Enter') { event.preventDefault(); add(expanded && names[active] ? names[active] : text); }
      }} />
      <button type="button" className="secondary" disabled={disabled || atLimit || !q || composing} onClick={() => add(text)}>추가</button>
    </div>
    {expanded && <ul className="tag-suggestions" id={`${id}-options`} role="listbox" aria-label="기존 태그">
      {names.map((name, index) => <li id={`${id}-option-${index}`} key={name} role="option" aria-selected={active === index}
        onMouseDown={event => event.preventDefault()} onClick={() => add(name)}>{name}</li>)}
    </ul>}
    <p id={`${id}-help`} className="field-help">{atLimit ? '태그는 20개까지 추가할 수 있습니다. 먼저 기존 태그를 삭제해 주세요.' : '기존 태그를 선택하거나 Enter·추가 버튼으로 새 태그를 추가하세요.'}</p>
    <div className="field-help" role="status">{message || (visible && (search.q !== q || search.state === 'loading') ? '태그 찾는 중…' :
      visible && search.state === 'error' ? '태그를 불러오지 못했습니다. 직접 입력해 추가할 수 있습니다.' :
      visible && !names.length ? '일치하는 기존 태그가 없습니다.' : '')}</div>
    {search.state === 'error' && search.q === q && q && <button type="button" className="text-button" disabled={disabled || atLimit}
      onClick={() => { setRetry(retry + 1); setOpen(true); input.current?.focus(); }}>태그 다시 찾기</button>}
    <ul className="tag-chips">{value.map(tag => <li key={tag}>{tag}<button type="button" className="text-button" disabled={disabled}
      aria-label={`${tag} 태그 삭제`} onClick={() => { onChange(value.filter(name => name !== tag)); setMessage(`${tag} 태그를 삭제했습니다.`); }}>삭제</button></li>)}</ul>
  </div>;
}
