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
      sx={{
        borderRadius: "0.85rem",
        minWidth: "11rem",
        paddingX: "1.25rem",
        paddingY: "0.65rem",
        textTransform: "none",
        fontSize: "1rem",
        fontWeight: 700,
        background: "linear-gradient(135deg, #ea580c, #dc2626)",
      }}
    >
      Convert
    </Button>
  );
};

export default ConvertButton;
