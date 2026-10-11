// Remotion CLI config. Run every remotion command from the video/ folder
// (npm scripts do that for you) so this file and public/ are found.
import { Config } from "@remotion/cli/config";

Config.setEntryPoint("./remotion/index.ts");
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
