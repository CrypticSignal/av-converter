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

  useEffect(() => {
    dispatch(setDefault(initialValue));
  }, []);

  return (
    <div>
      <br />
      <input
        type="range"
        id="bitrate_slider"
        className="slider"
        min={min}
        max={max}
        value={useAppSelector((state) => state.bitrate.value)}
        step={step}
        onChange={(e) => dispatch(change(e.target.value))}
      />
      <span>{` ${useAppSelector((state) => state.bitrate.value)} kbps`}</span>
    </div>
  );
};

export default BitrateSlider;
