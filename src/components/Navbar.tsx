import { Link } from "react-router-dom";
import gitHubLogo from "../images/GitHub-Mark-Light-32px.png";

const Navbar = () => {
  const setClassName = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    let linksDiv = document.getElementById("links")!;
    if (linksDiv.className === "top") {
      linksDiv.className += " mobile";
    } else {
      linksDiv.className = "top";
    }
  };

  return (
    <div id="links" className="top">
      <Link to="/" className="hamburger" onClick={setClassName}>
        <i className="fa fa-bars"></i>
      </Link>
      <Link to="/">Home</Link>
      <Link to="/about">About</Link>
      <Link to="/filetypes">Filetypes</Link>
      <Link
        to="/game"
        onClick={() => {
          window.location.href = "game";
        }}
      >
        Game
      </Link>
      <a href="https://github.com/CrypticSignal/av-converter" id="github_link">
        <img src={gitHubLogo} alt="github logo" />
      </a>
    </div>
  );
};

export default Navbar;
