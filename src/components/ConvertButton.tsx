import React from "react";
import Button from "@mui/material/Button";

interface ConvertButtonProps {
  onConvertClicked: () => void;
}

const ConvertButton: React.FC<ConvertButtonProps> = ({ onConvertClicked }) => {
  return (
    <Button
      variant="contained"
      color="primary"
      onClick={onConvertClicked}
    >
      Convert
    </Button>
  );
};

export default ConvertButton;
