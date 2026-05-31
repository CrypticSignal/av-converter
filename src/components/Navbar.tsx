import gitHubLogo from "../images/GitHub-Mark-Light-32px.png";

const Navbar = () => {
  return (
    <nav className="pt-4 px-3 sm:px-5">
      <div className="glass-card mx-auto w-full max-w-[920px] px-3 py-2 sm:px-5 sm:py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <p className="m-0 text-sm sm:text-base font-semibold tracking-wide text-slate-800">
              AV Converter
            </p>
          <a
            href="/game"
            className="text-slate-700 text-center hover:bg-sky-100 hover:text-slate-900 px-3 py-2 rounded-lg transition-colors"
          >
            Game
          </a>
        </div>
        <a
          href="https://github.com/CrypticSignal/av-converter"
          className="hover:bg-sky-100 p-2 rounded-lg transition-colors"
        >
          <img src={gitHubLogo} alt="github logo" className="block h-8 w-8" />
        </a>
      </div>
      </div>
    </nav>
  );
};

export default Navbar;
