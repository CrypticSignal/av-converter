const showAlert = (message: string, type: string): void => {
  const alertWrapper = document.getElementById("alert_wrapper")!;
  alertWrapper.style.display = "block";
  alertWrapper.innerHTML = `<div class="alert alert-${type}" role="alert">${message}</div>`;
};

export default showAlert;
