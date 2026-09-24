"use client";
import { KEYS, type KeyId } from "@/lib/keys";
export default function KeyPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: KeyId[];
  onChange: (v: KeyId[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="key-picker" disabled={disabled}>
      <legend>
        생성할 조 <small>여러 개 선택할 수 있어요</small>
      </legend>
      <div>
        {KEYS.map((k) => (
          <label key={k.id} className={value.includes(k.id) ? "checked" : ""}>
            <input
              type="checkbox"
              checked={value.includes(k.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, k.id]
                    : value.filter((v) => v !== k.id),
                )
              }
            />
            {k.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
