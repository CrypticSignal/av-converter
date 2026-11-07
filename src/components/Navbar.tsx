import gitHubLogo from "../images/GitHub-Mark-Light-32px.png";
import { NavLink } from 'react-router-dom';

const linkClass = "px-3 py-1.5 rounded-full text-sm font-medium transition-colors";
const idleClass = "text-slate-300 hover:text-white hover:bg-white/10";

const Navbar = () => {
  return (
    <nav className="sticky top-0 z-20 border-b border-white/10 bg-[#070a13]/70 backdrop-blur-xl">
      <div className="max-w-5xl mx-auto flex items-center justify-between px-4 py-3">
        <NavLink to="/" className="flex items-center gap-2 font-bold tracking-tight text-white">
          <span className="grid place-items-center h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400 shadow-lg shadow-violet-500/30">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
            </svg>
          </span>
          <span className="hidden sm:inline">AV Converter</span>
        </NavLink>
        <div className="flex items-center gap-1">
          <NavLink to="/" end
            className={({ isActive }) => `${linkClass} ${isActive ? "bg-white/10 text-white" : idleClass}`}>
            Converter
          </NavLink>
          <a href="/game" className={`${linkClass} ${idleClass}`}>Game</a>
          <a
            href="https://github.com/CrypticSignal/av-converter"
            className="ml-1 p-1.5 rounded-full hover:bg-white/10 transition-colors"
          >
            <img src={gitHubLogo} alt="GitHub repository" className="block h-6 w-6" />
          </a>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
