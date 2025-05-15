const reset = () => {
  document.getElementById("converting_spinner")!.style.display = "none";
  document.getElementById("conversion_progress")!.style.display = "none";
  document.getElementById("convert_btn")!.style.display = "block";
};

export default reset;
