import gitHubLogo from "../images/GitHub-Mark-Light-32px.png";

const Navbar = () => {
  return (
    <nav className="bg-black text-white">
      <div className="flex items-center justify-between p-2.5">
        <div className="flex items-center">
          <a
            href="/game"
            className="text-white text-center hover:bg-green-300 hover:text-black px-3 py-2 rounded-md"
          >
            Game
          </a>
        </div>
        <a
          href="https://github.com/CrypticSignal/av-converter"
          className="text-white hover:bg-green-300 hover:text-black p-2 rounded-md"
        >
          <img src={gitHubLogo} alt="github logo" className="block h-8 w-8" />
        </a>
      </div>
    </nav>
  );
};

export default Navbar;