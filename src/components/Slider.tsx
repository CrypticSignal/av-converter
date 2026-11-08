/**
 * The app's slider, built on Base UI's unstyled slider, which handles dragging, touch,
 * the keyboard and screen readers. Pass one number for one handle, or [start, end] for two.
 */
import React from 'react';
import { Slider as BaseSlider } from '@base-ui/react/slider';

export interface SliderProps<Value extends number | readonly number[]> {
  value: Value;
  min: number;
  max: number;
  step: number;
  /** How far Page Up/Page Down and Shift+arrow keys move a handle. Defaults to ten steps. */
  largeStep?: number;
  /** Called while dragging, with the new value and the index of the handle that moved. */
  onChange: (value: Value, activeThumb: number) => void;
  /** Turns a value into the text shown above a handle and read by screen readers. */
  formatValue: (value: number) => string;
  /** A visible label, shown above the slider on the left. Its handles are named after it. */
  label?: React.ReactNode;
  /** Shown above the slider on the right, e.g. the current value. */
  valueText?: React.ReactNode;
  /** Names each handle for screen readers, when they need their own names (e.g. "Start", "End"). */
  getAriaLabel?: (index: number) => string;
  className?: string;
}

const Slider = <Value extends number | readonly number[]>({
  value, min, max, step, largeStep = step * 10, onChange, formatValue, label, valueText, getAriaLabel, className = '',
}: SliderProps<Value>) => {
  const values: readonly number[] = typeof value === 'number' ? [value] : value as readonly number[];
  return (
    <BaseSlider.Root
      value={value}
      min={min}
      max={max}
      step={step}
      largeStep={largeStep}
      // Like MUI's disableSwap: a handle stops at the other one rather than passing it.
      thumbCollisionBehavior="none"
      onValueChange={(newValue, details) => onChange(newValue as Value, details.activeThumbIndex)}
      // A disabled <fieldset> disables the handles' inputs; this also stops dragging then.
      className={`touch-none select-none in-[fieldset:disabled]:pointer-events-none in-[fieldset:disabled]:opacity-50 ${className}`}
    >
      {(label || valueText) && (
        <div className="mb-1 flex justify-between gap-3 text-sm">
          {label && <BaseSlider.Label className="text-slate-300">{label}</BaseSlider.Label>}
          {valueText && <span className="font-semibold text-slate-100 tabular-nums">{valueText}</span>}
        </div>
      )}
      <BaseSlider.Control className="flex h-6 w-full cursor-pointer items-center">
        <BaseSlider.Track className="relative h-1.5 w-full rounded-full bg-white/10">
          <BaseSlider.Indicator className="rounded-full bg-linear-to-r from-violet-500 to-cyan-400" />
          {values.map((thumbValue, index) => (
            <BaseSlider.Thumb
              key={index}
              index={index}
              getAriaLabel={getAriaLabel}
              getAriaValueText={(_formatted, raw) => formatValue(raw)}
              className="group size-4.5 rounded-full bg-white shadow-[0_0_0_4px_rgba(139,92,246,0.35),0_2px_8px_rgba(0,0,0,0.5)]
                outline-none transition-shadow
                hover:shadow-[0_0_0_6px_rgba(139,92,246,0.4),0_2px_8px_rgba(0,0,0,0.5)]
                has-focus-visible:shadow-[0_0_0_7px_rgba(139,92,246,0.55),0_2px_8px_rgba(0,0,0,0.5)]
                data-dragging:shadow-[0_0_0_8px_rgba(139,92,246,0.45),0_2px_8px_rgba(0,0,0,0.5)]"
            >
              {/* The value, shown above the handle while it's hovered, focused or dragged. */}
              <span aria-hidden="true"
                className="pointer-events-none absolute bottom-full left-1/2 mb-2.5 -translate-x-1/2 translate-y-1 rounded-md
                  bg-violet-600 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-white tabular-nums opacity-0
                  shadow-lg shadow-violet-900/50 transition
                  group-hover:translate-y-0 group-hover:opacity-100
                  group-has-focus-visible:translate-y-0 group-has-focus-visible:opacity-100
                  group-data-dragging:translate-y-0 group-data-dragging:opacity-100">
                {formatValue(thumbValue)}
              </span>
            </BaseSlider.Thumb>
          ))}
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
};

export default Slider;
