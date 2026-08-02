import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
}

/** Поле пароля с показом введённого.
 *
 *  Не украшение. Пароль набирается вслепую, и две самые частые
 *  причины «пароль верный, а не пускает» — Caps Lock и русская
 *  раскладка — глазами не видны вообще. Подсказка про раскладку
 *  появляется, только когда в поле действительно есть кириллица:
 *  предупреждать заранее значит приучать не читать предупреждения. */
export function PasswordInput({ value, onChange, autoComplete, placeholder }: Props) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const hasCyrillic = /[а-яё]/i.test(value);

  return (
    <>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
          onBlur={() => setCapsLock(false)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          className="w-full rounded-md border border-rail bg-rail p-2.5 pr-11 text-body outline-none transition-colors focus:border-accent"
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          // Кнопка внутри формы обязана быть type="button": иначе
          // клик по ней отправлял бы форму.
          aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
          title={visible ? "Скрыть пароль" : "Показать пароль"}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1.5 text-muted hover:bg-hover hover:text-bright"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>

      {capsLock && (
        <span className="mt-1 block text-xs text-idle">Включён Caps Lock</span>
      )}
      {hasCyrillic && (
        <span className="mt-1 block text-xs text-idle">
          В пароле кириллица — возможно, включена русская раскладка
        </span>
      )}
    </>
  );
}
