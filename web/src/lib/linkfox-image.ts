/** 来源：LinkFox 生图 V3 文档及 /image/model/config/list?bizType=77。 */
export type LinkfoxImageModel = {
    name: string;
    label?: string;
    resolutions: string[];
    ratios: string[];
    qualities?: string[];
    references: number;
};

export const LINKFOX_IMAGE_MODEL_SPECS: LinkfoxImageModel[] = [
    { name: "BANANA_PRO", label: "LF全能模型 Pro", resolutions: ["1K", "2K", "4K"], ratios: ["1:1", "16:9", "9:16", "3:4", "4:3", "3:2", "2:3", "4:5", "5:4", "21:9"], references: 10 },
    { name: "BANANA_2_1", label: "LF全能模型 2.1", resolutions: ["1K", "2K", "4K"], ratios: ["1:1", "16:9", "9:16", "3:4", "4:3", "3:2", "2:3", "4:5", "5:4", "21:9"], references: 14 },
    { name: "BANANA_2_LITE", label: "LF全能模型 Lite", resolutions: ["1K"], ratios: ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"], references: 0 },
    { name: "BANANA", label: "LF全能模型", resolutions: ["1K"], ratios: ["1:1", "16:9", "9:16", "3:4", "4:3", "3:2", "2:3", "4:5", "5:4", "21:9"], references: 6 },
    { name: "GPT_2_5_IMAGE", label: "LF智能模型 G-2.5 Sunburst", resolutions: ["1K", "2K", "4K"], ratios: ["1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "4:5", "5:4", "21:9", "9:21"], qualities: ["low", "medium", "high", "xhigh", "max"], references: 10 },
    { name: "GPT_2_5_F_IMAGE", label: "LF智能模型 G-2.5 Flare", resolutions: ["1K", "2K", "4K"], ratios: ["1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "4:5", "5:4", "21:9", "9:21"], qualities: ["low", "medium", "high", "xhigh", "max"], references: 10 },
    { name: "GPT_2_IMAGE", label: "LF智能模型 G-2", resolutions: ["1K", "2K", "4K"], ratios: ["1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "4:5", "5:4", "21:9", "9:21"], qualities: ["low", "medium", "high"], references: 10 },
    { name: "AIDRAW_EDIT", label: "Linkfox-Image-1", resolutions: ["2K"], ratios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"], references: 4 },
    { name: "WAN2_7", label: "Wan 2.7", resolutions: ["1K", "2K"], ratios: ["1:1", "1:4", "4:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "16:9", "9:16", "21:9"], references: 6 },
    { name: "SEEDREAM5_PRO", label: "Seedream 5.0 Pro", resolutions: ["1K", "2K"], ratios: ["1:1", "3:4", "4:3", "9:16", "16:9", "3:2", "2:3", "21:9"], references: 6 },
];

export function linkfoxImageModel(value: string) {
    const name = value.split("::").at(-1)?.trim().toUpperCase();
    return LINKFOX_IMAGE_MODEL_SPECS.find((model) => model.name === name);
}
