import React from "react";

interface ConvertButtonProps {
  onConvertClicked: () => void;
}

const ConvertButton: React.FC<ConvertButtonProps> = ({ onConvertClicked }) => {
  return (
    <button id="convert_btn" className="btn btn-primary" onClick={onConvertClicked}>
      Convert
    </button>
  );
};

export default ConvertButton;
