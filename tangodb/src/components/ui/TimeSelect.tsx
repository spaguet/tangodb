import { useMemo } from "react";
import AppSelect from "./AppSelect";
import { minutesToTime, normalizeTime, timeToMinutes } from "../../lib/scheduleWeek";

interface TimeSelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  stepMinutes?: number;
  minTime?: string;
  maxTime?: string;
  required?: boolean;
  disabled?: boolean;
}

function buildTimeOptions(stepMinutes: number, minTime: string, maxTime: string): string[] {
  const min = timeToMinutes(minTime);
  const max = timeToMinutes(maxTime);
  const options: string[] = [];
  for (let m = min; m <= max; m += stepMinutes) {
    options.push(minutesToTime(m));
  }
  return options;
}

export default function TimeSelect({
  label,
  value,
  onChange,
  stepMinutes = 15,
  minTime = "07:00",
  maxTime = "22:00",
  required,
  disabled,
}: TimeSelectProps) {
  const options = useMemo(
    () => buildTimeOptions(stepMinutes, minTime, maxTime),
    [stepMinutes, minTime, maxTime]
  );

  let normalizedValue: string;
  try {
    normalizedValue = normalizeTime(value);
  } catch {
    normalizedValue = options[0] ?? "09:00";
  }

  const selectValue = options.includes(normalizedValue) ? normalizedValue : options[0] ?? normalizedValue;

  return (
    <AppSelect
      label={label}
      value={selectValue}
      required={required}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((time) => (
        <option key={time} value={time}>
          {time}
        </option>
      ))}
    </AppSelect>
  );
}
