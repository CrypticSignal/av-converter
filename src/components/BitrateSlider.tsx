import { useEffect } from "react";
import { useAppSelector, useAppDispatch } from "../redux/hooks";
import { change, setDefault } from "../redux/bitrateSliderSlice";

interface BitrateSliderProps {
  initialValue: string;
  min: string;
  max: string;
  step: string;
}

const BitrateSlider: React.FC<BitrateSliderProps> = ({ initialValue, min, max, step }) => {
  const dispatch = useAppDispatch();
  const currentValue = useAppSelector((state) => state.bitrate.value);

  useEffect(() => {
    dispatch(setDefault(initialValue));
  }, [dispatch, initialValue]);

  const getBackgroundSize = () => {
    const minVal = parseInt(min, 10);
    const maxVal = parseInt(max, 10);
    const currentVal = parseInt(currentValue, 10);
    const percentage = ((currentVal - minVal) * 100) / (maxVal - minVal);
    return Math.max(0, Math.min(100, percentage)); // Clamp between 0 and 100
  };

  const backgroundPercentage = getBackgroundSize();

  const sliderStyle = {
    background: `linear-gradient(to right, #2563eb ${backgroundPercentage}%, #d1d5db ${backgroundPercentage}%)`,
  };

  return (
    <div className="w-full max-w-xs mx-auto my-4">
      <div className="flex items-center"> 
        <input
          type="range"
          id="bitrate_slider"
          className="appearance-none w-full h-3 rounded-full outline-none cursor-pointer"
          min={min}
          max={max}
          value={currentValue}
          step={step}
          onChange={(e) => dispatch(change(e.target.value))}
          style={sliderStyle}
        />
        <span className="ml-4 text-sm text-gray-700 whitespace-nowrap">{` ${currentValue} kbps`}</span>
      </div>
    </div>
  );
};

export default BitrateSlider;
