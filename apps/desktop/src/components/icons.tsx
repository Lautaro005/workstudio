// App icons: Phosphor (regular weight, duotone in app glyphs), exported under the names the views use.
import type { ComponentType, CSSProperties, MouseEventHandler } from "react";
import {
  PulseIcon, ArrowRightIcon, ArrowUpIcon, ArrowCircleUpIcon, ArrowUpRightIcon, BellSimpleIcon, BellRingingIcon, RobotIcon, CubeIcon, BrainIcon,
  CheckIcon, ChecksIcon, CaretDownIcon, CaretDoubleLeftIcon, CaretDoubleRightIcon, WarningCircleIcon, CheckCircleIcon, ColumnsIcon, CopyIcon, CpuIcon,
  DownloadSimpleIcon, ArrowSquareOutIcon, FileCodeIcon, FolderOpenIcon, DiamondIcon, GitBranchIcon, GlobeSimpleIcon, DotsNineIcon, HouseSimpleIcon, InfoIcon,
  TranslateIcon, SquaresFourIcon, LinkSimpleIcon, TreeStructureIcon, CircleNotchIcon, ArrowsOutSimpleIcon, ChatCircleIcon, NotePencilIcon, ArrowsInSimpleIcon,
  MonitorIcon, MoonIcon, DotsThreeIcon, CursorIcon, NotebookIcon, PlayIcon, PlugIcon, PlusIcon, ArrowsClockwiseIcon, ArrowClockwiseIcon, RowsIcon,
  MagnifyingGlassIcon, HardDrivesIcon, GearSixIcon, SparkleIcon, StopIcon, TerminalWindowIcon, SunIcon, TrashIcon, LinkBreakIcon, WrenchIcon, XIcon,
  SlidersHorizontalIcon, EyeIcon, EyeSlashIcon, type IconProps as PIconProps, type IconWeight,
} from "@phosphor-icons/react";

export type IconProps = {
  size?: number | string;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
  weight?: IconWeight;
  onClick?: MouseEventHandler<SVGSVGElement>;
  "aria-hidden"?: boolean;
};
export type Icon = ComponentType<IconProps>;

const mk = (I: ComponentType<PIconProps>, def: IconWeight = "regular"): Icon => {
  const C = ({ strokeWidth: _s, weight, size = 24, ...rest }: IconProps) => <I weight={weight ?? def} size={size} {...rest} />;
  return C;
};

export const Activity = mk(PulseIcon);
export const ArrowRight = mk(ArrowRightIcon);
export const ArrowUp = mk(ArrowUpIcon, "bold");
export const ArrowUpCircle = mk(ArrowCircleUpIcon);
export const ArrowUpRight = mk(ArrowUpRightIcon);
export const Bell = mk(BellSimpleIcon);
export const BellRing = mk(BellRingingIcon);
export const Bot = mk(RobotIcon);
export const Box = mk(CubeIcon);
export const Brain = mk(BrainIcon);
export const Check = mk(CheckIcon, "bold");
export const CheckCheck = mk(ChecksIcon);
export const ChevronDown = mk(CaretDownIcon);
export const ChevronsLeft = mk(CaretDoubleLeftIcon);
export const ChevronsRight = mk(CaretDoubleRightIcon);
export const CircleAlert = mk(WarningCircleIcon);
export const CircleCheck = mk(CheckCircleIcon);
export const Columns3 = mk(ColumnsIcon);
export const Copy = mk(CopyIcon);
export const Cpu = mk(CpuIcon);
export const Download = mk(DownloadSimpleIcon);
export const ExternalLink = mk(ArrowSquareOutIcon);
export const FileCode2 = mk(FileCodeIcon);
export const FolderOpen = mk(FolderOpenIcon);
export const Gem = mk(DiamondIcon);
export const GitBranch = mk(GitBranchIcon);
export const Globe = mk(GlobeSimpleIcon);
export const Grid3x3 = mk(DotsNineIcon, "bold");
export const House = mk(HouseSimpleIcon);
export const Info = mk(InfoIcon);
export const Languages = mk(TranslateIcon);
export const LayoutGrid = mk(SquaresFourIcon);
export const Link2 = mk(LinkSimpleIcon);
export const ListTree = mk(TreeStructureIcon);
export const Loader2 = mk(CircleNotchIcon, "bold");
export const Maximize2 = mk(ArrowsOutSimpleIcon);
export const MessageSquare = mk(ChatCircleIcon);
export const MessageSquarePlus = mk(NotePencilIcon);
export const Minimize2 = mk(ArrowsInSimpleIcon);
export const Monitor = mk(MonitorIcon);
export const Moon = mk(MoonIcon);
export const MoreHorizontal = mk(DotsThreeIcon, "bold");
export const MousePointer2 = mk(CursorIcon);
export const NotebookPen = mk(NotebookIcon);
export const Play = mk(PlayIcon, "fill");
export const Plug = mk(PlugIcon);
export const Plus = mk(PlusIcon);
export const RefreshCw = mk(ArrowsClockwiseIcon);
export const RotateCw = mk(ArrowClockwiseIcon);
export const Rows3 = mk(RowsIcon);
export const Search = mk(MagnifyingGlassIcon);
export const Server = mk(HardDrivesIcon);
export const Settings = mk(GearSixIcon);
export const Sliders = mk(SlidersHorizontalIcon);
export const Sparkles = mk(SparkleIcon);
export const Square = mk(StopIcon, "fill");
export const SquareTerminal = mk(TerminalWindowIcon);
export const Sun = mk(SunIcon);
export const Trash2 = mk(TrashIcon);
export const Unlink = mk(LinkBreakIcon);
export const Wrench = mk(WrenchIcon);
export const X = mk(XIcon);
export const Eye = mk(EyeIcon);
export const EyeOff = mk(EyeSlashIcon);
