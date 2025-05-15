import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { RootState } from "./store";

interface BitrateSliderState {
  value: string;
}

const initialState: BitrateSliderState = { value: "192" };

const bitrateSliderSlice = createSlice({
  name: "bitrateSlider",
  initialState,
  reducers: {
    setDefault: (state, action: PayloadAction<string>) => {
      state.value = action.payload;
    },
    change: (state, action: PayloadAction<string>) => {
      state.value = action.payload;
    },
  },
});

export const { change, setDefault } = bitrateSliderSlice.actions;

export const selectBitrateSliderValue = (state: RootState) => state.bitrate.value;

export default bitrateSliderSlice.reducer;
