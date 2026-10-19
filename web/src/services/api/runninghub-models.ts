export type RunninghubModelParam = {
    fieldKey: string;
    type: string;
    required?: boolean;
    defaultValue?: string | number | boolean;
    options?: string[];
    min?: number;
    max?: number;
};

export type RunninghubModelDef = {
    name: string;
    label: string;
    capability: "audio" | "image" | "text" | "video" | "model";
    params?: RunninghubModelParam[];
    maxImages?: number;
};

export const RUNNINGHUB_REALISTIC_IMAGE = "run/ai-app/2098060610079649793";

export function runninghubImagesPerTask(model: string) {
    const name = (model.includes("::") ? model.slice(model.indexOf("::") + 2) : model).replace(/^\/+/, "");
    return name === RUNNINGHUB_REALISTIC_IMAGE || name.startsWith("youchuan/") ? 4 : 1;
}

export const RUNNINGHUB_CN_MODELS: RunninghubModelDef[] = [{
    name: RUNNINGHUB_REALISTIC_IMAGE,
    label: "真实感文生图",
    capability: "image",
    maxImages: 0,
    params: [
        { fieldKey: "width", type: "INT", defaultValue: 720 },
        { fieldKey: "height", type: "INT", defaultValue: 1280 },
    ],
}];

export const RUNNINGHUB_MODELS: RunninghubModelDef[] = [
    {
        "name": "rhart-image-g-2.5-official-token/sunburst/text-to-image",
        "label": "gpt-image-2.5/sunburst/text-to-image/stable-token",
        "capability": "image",
        "params": [
            {
                "fieldKey": "aspectRatio",
                "type": "LIST",
                "required": false,
                "defaultValue": "16:9",
                "options": [
                    "1:1",
                    "1:2",
                    "2:1",
                    "1:3",
                    "3:1",
                    "2:3",
                    "3:2",
                    "3:4",
                    "4:3",
                    "4:5",
                    "5:4",
                    "9:16",
                    "21:9",
                    "9:21",
                    "16:9"
                ]
            },
            {
                "fieldKey": "resolution",
                "type": "LIST",
                "required": true,
                "defaultValue": "2k",
                "options": [
                    "1k",
                    "2k",
                    "4k"
                ]
            },
            {
                "fieldKey": "background",
                "type": "LIST",
                "required": false,
                "defaultValue": "auto",
                "options": [
                    "auto",
                    "transparent",
                    "opaque"
                ]
            },
            {
                "fieldKey": "quality",
                "type": "LIST",
                "required": false,
                "defaultValue": "high",
                "options": [
                    "auto",
                    "low",
                    "medium",
                    "high",
                    "xhigh",
                    "max"
                ]
            },
            {
                "fieldKey": "outputFormat",
                "type": "LIST",
                "required": false,
                "defaultValue": "png",
                "options": [
                    "jpeg",
                    "png",
                    "webp"
                ]
            }
        ]
    },
    {
        "name": "rhart-image-g-2.5-official-token/sunburst/edit",
        "label": "gpt-image-2.5/sunburst/image-to-image/stable-token",
        "capability": "image",
        "maxImages": 16,
        "params": [
            {
                "fieldKey": "aspectRatio",
                "type": "LIST",
                "required": false,
                "defaultValue": "16:9",
                "options": [
                    "1:1",
                    "1:2",
                    "2:1",
                    "1:3",
                    "3:1",
                    "2:3",
                    "3:2",
                    "3:4",
                    "4:3",
                    "4:5",
                    "5:4",
                    "9:16",
                    "21:9",
                    "9:21",
                    "16:9"
                ]
            },
            {
                "fieldKey": "resolution",
                "type": "LIST",
                "required": true,
                "defaultValue": "2k",
                "options": [
                    "1k",
                    "2k",
                    "4k"
                ]
            },
            {
                "fieldKey": "background",
                "type": "LIST",
                "required": false,
                "defaultValue": "auto",
                "options": [
                    "auto",
                    "transparent",
                    "opaque"
                ]
            },
            {
                "fieldKey": "quality",
                "type": "LIST",
                "required": false,
                "defaultValue": "high",
                "options": [
                    "auto",
                    "low",
                    "medium",
                    "high",
                    "xhigh",
                    "max"
                ]
            },
            {
                "fieldKey": "outputFormat",
                "type": "LIST",
                "required": false,
                "defaultValue": "png",
                "options": [
                    "jpeg",
                    "png",
                    "webp"
                ]
            }
        ]
    },
    {
        "name": "rhart-image-g-2.5-official-token/flare/text-to-image",
        "label": "gpt-image-2.5/flare/text-to-image/stable-token",
        "capability": "image",
        "params": [
            {
                "fieldKey": "aspectRatio",
                "type": "LIST",
                "required": false,
                "defaultValue": "16:9",
                "options": [
                    "1:1",
                    "1:2",
                    "2:1",
                    "1:3",
                    "3:1",
                    "2:3",
                    "3:2",
                    "3:4",
                    "4:3",
                    "4:5",
                    "5:4",
                    "9:16",
                    "21:9",
                    "9:21",
                    "16:9"
                ]
            },
            {
                "fieldKey": "resolution",
                "type": "LIST",
                "required": true,
                "defaultValue": "2k",
                "options": [
                    "1k",
                    "2k",
                    "4k"
                ]
            },
            {
                "fieldKey": "background",
                "type": "LIST",
                "required": false,
                "defaultValue": "auto",
                "options": [
                    "auto",
                    "transparent",
                    "opaque"
                ]
            },
            {
                "fieldKey": "quality",
                "type": "LIST",
                "required": false,
                "defaultValue": "high",
                "options": [
                    "auto",
                    "low",
                    "medium",
                    "high",
                    "xhigh",
                    "max"
                ]
            },
            {
                "fieldKey": "outputFormat",
                "type": "LIST",
                "required": false,
                "defaultValue": "png",
                "options": [
                    "jpeg",
                    "png",
                    "webp"
                ]
            }
        ]
    },
    {
        "name": "rhart-image-g-2.5-official-token/flare/edit",
        "label": "gpt-image-2.5/flare/image-to-image/stable-token",
        "capability": "image",
        "maxImages": 16,
        "params": [
            {
                "fieldKey": "aspectRatio",
                "type": "LIST",
                "required": false,
                "defaultValue": "16:9",
                "options": [
                    "1:1",
                    "1:2",
                    "2:1",
                    "1:3",
                    "3:1",
                    "2:3",
                    "3:2",
                    "3:4",
                    "4:3",
                    "4:5",
                    "5:4",
                    "9:16",
                    "21:9",
                    "9:21",
                    "16:9"
                ]
            },
            {
                "fieldKey": "resolution",
                "type": "LIST",
                "required": true,
                "defaultValue": "2k",
                "options": [
                    "1k",
                    "2k",
                    "4k"
                ]
            },
            {
                "fieldKey": "background",
                "type": "LIST",
                "required": false,
                "defaultValue": "auto",
                "options": [
                    "auto",
                    "transparent",
                    "opaque"
                ]
            },
            {
                "fieldKey": "quality",
                "type": "LIST",
                "required": false,
                "defaultValue": "high",
                "options": [
                    "auto",
                    "low",
                    "medium",
                    "high",
                    "xhigh",
                    "max"
                ]
            },
            {
                "fieldKey": "outputFormat",
                "type": "LIST",
                "required": false,
                "defaultValue": "png",
                "options": [
                    "jpeg",
                    "png",
                    "webp"
                ]
            }
        ]
    },
    {
        "name": "rhart-image-g-2.5/flare/text-to-image",
        "label": "gpt-image-2.5/flare/text-to-image/economy",
        "capability": "image",
        "params": [
            {
                "fieldKey": "aspectRatio",
                "type": "LIST",
                "required": false,
                "defaultValue": "16:9",
                "options": [
                    "1:1",
                    "3:2",
                    "2:3",
                    "5:4",
                    "4:5",
                    "16:9",
                    "9:16",
                    "21:9",
                    "3:4",
                    "4:3"
                ]
            },
            {
                "fieldKey": "resolution",
                "type": "LIST",
                "required": false,
                "defaultValue": "1k",
                "options": [
                    "1k",
                    "2k",
                    "4k"
                ]
            }
        ]
    },
    {
        "name": "rhart-image-g-2.5/flare/image-to-image",
        "label": "gpt-image-2.5/flare/image-to-image/economy",
        "capability": "image",
        "maxImages": 10,
        "params": [
            {
                "fieldKey": "aspectRatio",
                "type": "LIST",
                "required": false,
                "defaultValue": "16:9",
                "options": [
                    "1:1",
                    "2:3",
                    "3:2",
                    "4:5",
                    "5:4",
                    "4:3",
                    "3:4",
                    "16:9",
                    "9:16",
                    "21:9",
                    "9:21",
                    "2:1",
                    "1:2",
                    "3:1",
                    "1:3"
                ]
            },
            {
                "fieldKey": "resolution",
                "type": "LIST",
                "required": false,
                "defaultValue": "1k",
                "options": [
                    "1k",
                    "2k",
                    "4k"
                ]
            }
        ]
    },
    {
        "name": "rhart-image-g-2.5/sunburst/text-to-image",
        "label": "gpt-image-2.5/sunburst/text-to-image/economy",
        "capability": "image",
        "params": [
            {
                "fieldKey": "aspectRatio",
                "type": "LIST",
                "required": false,
                "defaultValue": "16:9",
                "options": [
                    "1:1",
                    "3:2",
                    "2:3",
                    "5:4",
                    "4:5",
                    "16:9",
                    "9:16",
                    "21:9",
                    "3:4",
                    "4:3",
                    "9:21",
                    "1:2",
                    "2:1",
                    "1:3",
                    "3:1"
                ]
            },
            {
                "fieldKey": "resolution",
                "type": "LIST",
                "required": false,
                "defaultValue": "1k",
                "options": [
                    "1k",
                    "2k",
                    "4k"
                ]
            }
        ]
    },
    {
        "name": "rhart-image-g-2.5/sunburst/image-to-image",
        "label": "gpt-image-2.5/sunburst/image-to-image/economy",
        "capability": "image",
        "maxImages": 10,
        "params": [
            {
                "fieldKey": "aspectRatio",
                "type": "LIST",
                "required": false,
                "defaultValue": "16:9",
                "options": [
                    "1:1",
                    "2:3",
                    "3:2",
                    "4:5",
                    "5:4",
                    "4:3",
                    "3:4",
                    "16:9",
                    "9:16",
                    "21:9",
                    "9:21",
                    "2:1",
                    "1:2",
                    "3:1",
                    "1:3"
                ]
            },
            {
                "fieldKey": "resolution",
                "type": "LIST",
                "required": false,
                "defaultValue": "1k",
                "options": [
                    "1k",
                    "2k",
                    "4k"
                ]
            }
        ]
    },
    {
        name: "bytedance/doubao-seed-audio-1.0",
        label: "doubao-seed-audio-1.0",
        capability: "audio"
    },
    {
        name: "rhart-audio/text-to-audio/music-2.5",
        label: "minimax/music-2.5",
        capability: "audio"
    },
    {
        name: "minimax/music-2.6",
        label: "minimax/music-2.6",
        capability: "audio"
    },
    {
        name: "minimax/music-cover",
        label: "minimax/music-cover",
        capability: "audio"
    },
    {
        name: "minimax/music-cover-preprocess",
        label: "minimax/music-cover-preprocess",
        capability: "audio"
    },
    {
        name: "rhart-audio/text-to-audio/speech-02-hd",
        label: "minimax/speech-02-hd",
        capability: "audio"
    },
    {
        name: "rhart-audio/text-to-audio/speech-02-turbo",
        label: "minimax/speech-02-turbo",
        capability: "audio"
    },
    {
        name: "rhart-audio/text-to-audio/speech-2.6-hd",
        label: "minimax/speech-2.6-hd",
        capability: "audio"
    },
    {
        name: "rhart-audio/text-to-audio/speech-2.6-turbo",
        label: "minimax/speech-2.6-turbo",
        capability: "audio"
    },
    {
        name: "rhart-audio/text-to-audio/speech-2.8-hd",
        label: "minimax/speech-2.8-hd",
        capability: "audio"
    },
    {
        name: "rhart-audio/text-to-audio/speech-2.8-turbo",
        label: "minimax/speech-2.8-turbo",
        capability: "audio"
    },
    {
        name: "rhart-audio/text-to-audio/voice-clone",
        label: "minimax/voice-clone",
        capability: "audio"
    },
    {
        name: "minimax/voice-design",
        label: "minimax/voice-design",
        capability: "audio"
    },
    {
        name: "rhart-audio/suno-v4.5/custom",
        label: "suno-custom-v4.5",
        capability: "audio"
    },
    {
        name: "rhart-audio/suno-v5/custom",
        label: "suno-custom-v5",
        capability: "audio"
    },
    {
        name: "rhart-audio/suno-v5.5/custom",
        label: "suno-custom-v5.5",
        capability: "audio"
    },
    {
        name: "rhart-audio/suno/lyrics",
        label: "suno-lyrics",
        capability: "audio"
    },
    {
        name: "rhart-audio/suno-v4.5/single",
        label: "suno-single-v4.5",
        capability: "audio"
    },
    {
        name: "rhart-audio/suno-v5/single",
        label: "suno-single-v5",
        capability: "audio"
    },
    {
        name: "rhart-audio/suno-v5.5/single",
        label: "suno-single-v5.5",
        capability: "audio"
    },
    {
        name: "rhart-image-g-2/image-to-image",
        label: "gpt-image-2.0/edit-channel-low-price",
        capability: "image",
        params: [
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "empty",
                options: [
                    "empty",
                    "3:2",
                    "1:1",
                    "2:3",
                    "5:4",
                    "4:5",
                    "16:9",
                    "9:16",
                    "21:9",
                    "3:4",
                    "4:3",
                    "9:21",
                    "1:2",
                    "2:1",
                    "1:3",
                    "3:1"
                ]
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: false,
                defaultValue: "1k",
                options: [
                    "1k",
                    "2k",
                    "4k"
                ]
            }
        ]
    },
    {
        name: "rhart-image-g-2/text-to-image",
        label: "gpt-image-2.0/text-to-image-channel-low-price",
        capability: "image",
        params: [
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "empty",
                options: [
                    "empty",
                    "3:2",
                    "1:1",
                    "2:3",
                    "5:4",
                    "4:5",
                    "16:9",
                    "9:16",
                    "21:9",
                    "3:4",
                    "4:3",
                    "9:21",
                    "1:2",
                    "2:1",
                    "1:3",
                    "3:1"
                ]
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: false,
                defaultValue: "1k",
                options: [
                    "1k",
                    "2k",
                    "4k"
                ]
            }
        ]
    },
    {
        name: "rhart-image-g-2-official/image-to-image",
        label: "gpt-image-2/image-to-image-official-stable",
        capability: "image",
        params: [
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "empty",
                options: [
                    "empty",
                    "1:1",
                    "1:2",
                    "2:1",
                    "1:3",
                    "3:1",
                    "2:3",
                    "3:2",
                    "3:4",
                    "4:3",
                    "4:5",
                    "5:4",
                    "9:16",
                    "21:9",
                    "9:21",
                    "16:9"
                ]
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: true,
                defaultValue: "2k",
                options: [
                    "1k",
                    "2k",
                    "4k"
                ]
            },
            {
                fieldKey: "quality",
                type: "LIST",
                required: true,
                defaultValue: "medium",
                options: [
                    "low",
                    "medium",
                    "high"
                ]
            }
        ]
    },
    {
        name: "rhart-image-g-2-official/text-to-image",
        label: "gpt-image-2/text-to-image-official-stable",
        capability: "image",
        params: [
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "16:9",
                options: [
                    "1:1",
                    "1:2",
                    "2:1",
                    "1:3",
                    "3:1",
                    "2:3",
                    "3:2",
                    "3:4",
                    "4:3",
                    "4:5",
                    "5:4",
                    "9:16",
                    "21:9",
                    "9:21",
                    "16:9"
                ]
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: true,
                defaultValue: "2k",
                options: [
                    "1k",
                    "2k",
                    "4k"
                ]
            },
            {
                fieldKey: "quality",
                type: "LIST",
                required: true,
                defaultValue: "medium",
                options: [
                    "low",
                    "medium",
                    "high"
                ]
            }
        ]
    },
    {
        name: "youchuan/text-to-image-niji6",
        label: "midjourney-text-to-image-niji6",
        capability: "image",
        params: [
            {
                fieldKey: "chaos",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 100
            },
            {
                fieldKey: "quality",
                type: "LIST",
                required: false,
                defaultValue: "1",
                options: [
                    "0.5",
                    "1",
                    "2"
                ]
            },
            {
                fieldKey: "stylize",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 1000
            },
            {
                fieldKey: "weird",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 3000
            },
            {
                fieldKey: "raw",
                type: "BOOLEAN",
                required: false,
                defaultValue: false
            },
            {
                fieldKey: "iw",
                type: "INT",
                required: false,
                defaultValue: 1,
                min: 0,
                max: 3
            },
            {
                fieldKey: "cw",
                type: "INT",
                required: false,
                defaultValue: 100,
                min: 0,
                max: 100
            },
            {
                fieldKey: "sw",
                type: "INT",
                required: false,
                defaultValue: 100,
                min: 0,
                max: 1000
            },
            {
                fieldKey: "sv",
                type: "INT",
                required: false,
                defaultValue: 4,
                min: 1,
                max: 4
            },
            {
                fieldKey: "stop",
                type: "INT",
                required: false,
                defaultValue: 100,
                min: 10,
                max: 100
            },
            {
                fieldKey: "tile",
                type: "BOOLEAN",
                required: false,
                defaultValue: false
            },
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "1:1",
                options: [
                    "1:1",
                    "4:3",
                    "3:2",
                    "16:9",
                    "3:4",
                    "2:3",
                    "9:16"
                ]
            }
        ]
    },
    {
        name: "youchuan/text-to-image-niji7",
        label: "midjourney-text-to-image-niji7",
        capability: "image",
        params: [
            {
                fieldKey: "chaos",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 100
            },
            {
                fieldKey: "stylize",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 1000
            },
            {
                fieldKey: "weird",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 3000
            },
            {
                fieldKey: "raw",
                type: "BOOLEAN",
                required: false,
                defaultValue: false
            },
            {
                fieldKey: "iw",
                type: "INT",
                required: false,
                defaultValue: 1,
                min: 0,
                max: 2
            },
            {
                fieldKey: "sw",
                type: "INT",
                required: false,
                defaultValue: 100,
                min: 0,
                max: 1000
            },
            {
                fieldKey: "sv",
                type: "INT",
                required: false,
                defaultValue: 4,
                min: 1,
                max: 4
            },
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "1:1",
                options: [
                    "1:1",
                    "4:3",
                    "3:2",
                    "16:9",
                    "3:4",
                    "2:3",
                    "9:16"
                ]
            }
        ]
    },
    {
        name: "youchuan/text-to-image-v6",
        label: "midjourney-text-to-image-v6",
        capability: "image",
        params: [
            {
                fieldKey: "chaos",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 100
            },
            {
                fieldKey: "quality",
                type: "LIST",
                required: false,
                defaultValue: "1",
                options: [
                    "0.5",
                    "1",
                    "2"
                ]
            },
            {
                fieldKey: "stylize",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 1000
            },
            {
                fieldKey: "weird",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 3000
            },
            {
                fieldKey: "raw",
                type: "BOOLEAN",
                required: false,
                defaultValue: false
            },
            {
                fieldKey: "iw",
                type: "INT",
                required: false,
                defaultValue: 1,
                min: 0,
                max: 3
            },
            {
                fieldKey: "cw",
                type: "INT",
                required: false,
                defaultValue: 100,
                min: 0,
                max: 100
            },
            {
                fieldKey: "sw",
                type: "INT",
                required: false,
                defaultValue: 100,
                min: 0,
                max: 1000
            },
            {
                fieldKey: "sv",
                type: "INT",
                required: false,
                defaultValue: 4,
                min: 1,
                max: 4
            },
            {
                fieldKey: "stop",
                type: "INT",
                required: false,
                defaultValue: 100,
                min: 10,
                max: 100
            },
            {
                fieldKey: "tile",
                type: "BOOLEAN",
                required: false,
                defaultValue: false
            },
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "1:1",
                options: [
                    "1:1",
                    "4:3",
                    "3:2",
                    "16:9",
                    "3:4",
                    "2:3",
                    "9:16"
                ]
            }
        ]
    },
    {
        name: "youchuan/text-to-image-v61",
        label: "midjourney-text-to-image-v61",
        capability: "image",
        params: [
            {
                fieldKey: "chaos",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 100
            },
            {
                fieldKey: "quality",
                type: "LIST",
                required: false,
                defaultValue: "1",
                options: [
                    "0.5",
                    "1",
                    "2"
                ]
            },
            {
                fieldKey: "stylize",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 1000
            },
            {
                fieldKey: "weird",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 3000
            },
            {
                fieldKey: "raw",
                type: "BOOLEAN",
                required: false,
                defaultValue: false
            },
            {
                fieldKey: "iw",
                type: "INT",
                required: false,
                defaultValue: 1,
                min: 0,
                max: 3
            },
            {
                fieldKey: "cw",
                type: "INT",
                required: false,
                defaultValue: 100,
                min: 0,
                max: 100
            },
            {
                fieldKey: "sw",
                type: "INT",
                required: false,
                defaultValue: 100,
                min: 0,
                max: 1000
            },
            {
                fieldKey: "sv",
                type: "INT",
                required: false,
                defaultValue: 4,
                min: 1,
                max: 4
            },
            {
                fieldKey: "stop",
                type: "INT",
                required: false,
                defaultValue: 100,
                min: 10,
                max: 100
            },
            {
                fieldKey: "tile",
                type: "BOOLEAN",
                required: false,
                defaultValue: false
            },
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                options: [
                    "1:1",
                    "4:3",
                    "3:2",
                    "16:9",
                    "3:4",
                    "2:3",
                    "9:16"
                ]
            }
        ]
    },
    {
        name: "youchuan/text-to-image-v7",
        label: "midjourney-text-to-image-v7",
        capability: "image",
        params: [
            {
                fieldKey: "chaos",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 100
            },
            {
                fieldKey: "quality",
                type: "LIST",
                required: false,
                defaultValue: "1",
                options: [
                    "1",
                    "2",
                    "4"
                ]
            },
            {
                fieldKey: "stylize",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 1000
            },
            {
                fieldKey: "weird",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 3000
            },
            {
                fieldKey: "raw",
                type: "BOOLEAN",
                required: false,
                defaultValue: false
            },
            {
                fieldKey: "iw",
                type: "INT",
                required: false,
                defaultValue: 1,
                min: 0,
                max: 3
            },
            {
                fieldKey: "sw",
                type: "INT",
                required: false,
                defaultValue: 100,
                min: 0,
                max: 1000
            },
            {
                fieldKey: "sv",
                type: "INT",
                required: false,
                defaultValue: 4,
                min: 1,
                max: 6
            },
            {
                fieldKey: "ow",
                type: "INT",
                required: false,
                defaultValue: 100,
                min: 1,
                max: 1000
            },
            {
                fieldKey: "tile",
                type: "BOOLEAN",
                required: false,
                defaultValue: false
            },
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                options: [
                    "1:1",
                    "4:3",
                    "3:2",
                    "16:9",
                    "3:4",
                    "2:3",
                    "9:16"
                ]
            }
        ]
    },
    {
        name: "youchuan/text-to-image-v81",
        label: "midjourney-text-to-image-v8.1",
        capability: "image",
        params: [
            {
                fieldKey: "chaos",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 100
            },
            {
                fieldKey: "quality",
                type: "LIST",
                required: false,
                defaultValue: "1",
                options: [
                    "1",
                    "4"
                ]
            },
            {
                fieldKey: "stylize",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 1000
            },
            {
                fieldKey: "raw",
                type: "BOOLEAN",
                required: false,
                defaultValue: false
            },
            {
                fieldKey: "iw",
                type: "INT",
                required: false,
                defaultValue: 1,
                min: 0,
                max: 3
            },
            {
                fieldKey: "sw",
                type: "INT",
                required: false,
                defaultValue: 100,
                min: 0,
                max: 1000
            },
            {
                fieldKey: "sv",
                type: "INT",
                required: false,
                defaultValue: 6,
                min: 6,
                max: 6
            },
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                options: [
                    "1:1",
                    "4:3",
                    "3:2",
                    "16:9",
                    "3:4",
                    "2:3",
                    "9:16"
                ]
            },
            {
                fieldKey: "hd",
                type: "BOOLEAN",
                required: true,
                defaultValue: false
            }
        ]
    },
    {
        name: "youchuan/text-to-image-v82",
        label: "midjourney-text-to-image-v8.2-preview",
        capability: "image",
        params: [
            {
                fieldKey: "chaos",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 100
            },
            {
                fieldKey: "quality",
                type: "LIST",
                required: false,
                defaultValue: "1",
                options: [
                    "1",
                    "4"
                ]
            },
            {
                fieldKey: "stylize",
                type: "INT",
                required: false,
                defaultValue: 0,
                min: 0,
                max: 1000
            },
            {
                fieldKey: "raw",
                type: "BOOLEAN",
                required: false,
                defaultValue: false
            },
            {
                fieldKey: "iw",
                type: "INT",
                required: false,
                defaultValue: 1,
                min: 0,
                max: 3
            },
            {
                fieldKey: "sw",
                type: "INT",
                required: false,
                defaultValue: 100,
                min: 0,
                max: 1000
            },
            {
                fieldKey: "sv",
                type: "INT",
                required: false,
                defaultValue: 6,
                min: 6,
                max: 6
            },
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                options: [
                    "1:1",
                    "4:3",
                    "3:2",
                    "16:9",
                    "3:4",
                    "2:3",
                    "9:16"
                ]
            },
            {
                fieldKey: "hd",
                type: "BOOLEAN",
                required: true,
                defaultValue: false
            }
        ]
    },
    {
        name: "rhart-image-n-pro/edit",
        label: "nano-banana-pro/edit-channel-low-price",
        capability: "image",
        params: [
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "empty",
                options: [
                    "empty",
                    "1:1",
                    "16:9",
                    "9:16",
                    "4:3",
                    "3:4",
                    "3:2",
                    "2:3",
                    "5:4",
                    "4:5",
                    "21:9"
                ]
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: true,
                defaultValue: "1k",
                options: [
                    "1k",
                    "2k",
                    "4k"
                ]
            }
        ]
    },
    {
        name: "rhart-image-n-pro-official/edit",
        label: "nano-banana-pro/edit-official-stable",
        capability: "image",
        params: [
            {
                fieldKey: "resolution",
                type: "LIST",
                required: true,
                defaultValue: "1k",
                options: [
                    "1k",
                    "2k",
                    "4k"
                ]
            },
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "empty",
                options: [
                    "empty",
                    "1:1",
                    "3:2",
                    "2:3",
                    "3:4",
                    "4:3",
                    "4:5",
                    "5:4",
                    "9:16",
                    "16:9",
                    "21:9"
                ]
            }
        ]
    },
    {
        name: "rhart-image-n-pro-official/edit-ultra",
        label: "nano-banana-pro/edit-ultra-official-stable",
        capability: "image",
        params: [
            {
                fieldKey: "resolution",
                type: "LIST",
                required: true,
                defaultValue: "8k",
                options: [
                    "4k",
                    "8k"
                ]
            },
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "empty",
                options: [
                    "empty",
                    "1:1",
                    "3:2",
                    "2:3",
                    "3:4",
                    "4:3",
                    "4:5",
                    "5:4",
                    "9:16",
                    "16:9",
                    "21:9"
                ]
            }
        ]
    },
    {
        name: "rhart-image-n-pro/text-to-image",
        label: "nano-banana-pro/text-to-image-channel-low-price",
        capability: "image",
        params: [
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "9:16",
                options: [
                    "1:1",
                    "16:9",
                    "9:16",
                    "4:3",
                    "3:4",
                    "3:2",
                    "2:3",
                    "5:4",
                    "4:5",
                    "21:9"
                ]
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: true,
                defaultValue: "1k",
                options: [
                    "1k",
                    "2k",
                    "4k"
                ]
            }
        ]
    },
    {
        name: "rhart-image-n-pro-official/text-to-image",
        label: "nano-banana-pro/text-to-image-official-stable",
        capability: "image",
        params: [
            {
                fieldKey: "resolution",
                type: "LIST",
                required: true,
                defaultValue: "1k",
                options: [
                    "1k",
                    "2k",
                    "4k"
                ]
            },
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "3:4",
                options: [
                    "1:1",
                    "3:2",
                    "2:3",
                    "3:4",
                    "4:3",
                    "4:5",
                    "5:4",
                    "9:16",
                    "16:9",
                    "21:9"
                ]
            }
        ]
    },
    {
        name: "rhart-image-n-pro-official/text-to-image-ultra",
        label: "nano-banana-pro/text-to-image-ultra-official-stable",
        capability: "image",
        params: [
            {
                fieldKey: "resolution",
                type: "LIST",
                required: true,
                defaultValue: "8k",
                options: [
                    "4k",
                    "8k"
                ]
            },
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "3:4",
                options: [
                    "1:1",
                    "3:2",
                    "2:3",
                    "3:4",
                    "4:3",
                    "4:5",
                    "5:4",
                    "9:16",
                    "16:9",
                    "21:9"
                ]
            }
        ]
    },
    {
        name: "rhart-image-n-g31-flash-lite/image-to-image",
        label: "nano-banana2-gemini31flash-lite/image-to-image-channel-low-price",
        capability: "image",
        params: [
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "9:16",
                options: [
                    "1:1",
                    "16:9",
                    "9:16",
                    "4:3",
                    "3:4",
                    "3:2",
                    "2:3",
                    "5:4",
                    "4:5",
                    "21:9",
                    "1:4",
                    "4:1",
                    "1:8",
                    "8:1"
                ]
            }
        ]
    },
    {
        name: "rhart-image-n-g31-flash-lite-official/image-to-image",
        label: "nano-banana2-gemini31flash-lite/image-to-image-official-stable",
        capability: "image",
        params: [
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "auto",
                options: [
                    "auto",
                    "1:1",
                    "16:9",
                    "9:16",
                    "4:3",
                    "3:4",
                    "3:2",
                    "2:3",
                    "5:4",
                    "4:5",
                    "21:9",
                    "4:1",
                    "1:4",
                    "8:1",
                    "1:8"
                ]
            }
        ]
    },
    {
        name: "rhart-image-n-g31-flash-lite/text-to-image",
        label: "nano-banana2-gemini31flash-lite/text-to-image-channel-low-price",
        capability: "image",
        params: [
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "9:16",
                options: [
                    "1:1",
                    "16:9",
                    "9:16",
                    "4:3",
                    "3:4",
                    "3:2",
                    "2:3",
                    "5:4",
                    "4:5",
                    "21:9",
                    "1:4",
                    "4:1",
                    "1:8",
                    "8:1"
                ]
            }
        ]
    },
    {
        name: "rhart-image-n-g31-flash-lite-official/text-to-image",
        label: "nano-banana2-gemini31flash-lite/text-to-image-official-stable",
        capability: "image",
        params: [
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "1:1",
                options: [
                    "1:1",
                    "16:9",
                    "9:16",
                    "4:3",
                    "3:4",
                    "3:2",
                    "2:3",
                    "5:4",
                    "4:5",
                    "21:9",
                    "4:1",
                    "1:4",
                    "8:1",
                    "1:8"
                ]
            }
        ]
    },
    {
        name: "rhart-image-n-g31-flash/image-to-image",
        label: "nano-banana2-gemini31flash/image-to-image-channel-low-price",
        capability: "image",
        params: [
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "empty",
                options: [
                    "empty",
                    "1:1",
                    "16:9",
                    "9:16",
                    "4:3",
                    "3:4",
                    "3:2",
                    "2:3",
                    "5:4",
                    "4:5",
                    "21:9",
                    "1:4",
                    "4:1",
                    "1:8",
                    "8:1"
                ]
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: true,
                defaultValue: "1k",
                options: [
                    "1k",
                    "2k",
                    "4k"
                ]
            }
        ]
    },
    {
        name: "rhart-image-n-g31-flash-official/image-to-image",
        label: "nano-banana2-gemini31flash/image-to-image-official-stable",
        capability: "image",
        params: [
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "empty",
                options: [
                    "empty",
                    "1:1",
                    "16:9",
                    "9:16",
                    "4:3",
                    "3:4",
                    "3:2",
                    "2:3",
                    "5:4",
                    "4:5",
                    "21:9",
                    "1:4",
                    "4:1",
                    "1:8",
                    "8:1"
                ]
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: true,
                defaultValue: "1k",
                options: [
                    "1k",
                    "2k",
                    "4k"
                ]
            }
        ]
    },
    {
        name: "rhart-image-n-g31-flash/text-to-image",
        label: "nano-banana2-gemini31flash/text-to-image-channel-low-price",
        capability: "image",
        params: [
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "9:16",
                options: [
                    "1:1",
                    "16:9",
                    "9:16",
                    "4:3",
                    "3:4",
                    "3:2",
                    "2:3",
                    "5:4",
                    "4:5",
                    "21:9",
                    "1:4",
                    "4:1",
                    "1:8",
                    "8:1"
                ]
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: true,
                defaultValue: "1k",
                options: [
                    "1k",
                    "2k",
                    "4k"
                ]
            }
        ]
    },
    {
        name: "rhart-image-n-g31-flash-official/text-to-image",
        label: "nano-banana2-gemini31flash/text-to-image-official-stable",
        capability: "image",
        params: [
            {
                fieldKey: "aspectRatio",
                type: "LIST",
                required: false,
                defaultValue: "21:9",
                options: [
                    "1:1",
                    "16:9",
                    "9:16",
                    "4:3",
                    "3:4",
                    "3:2",
                    "2:3",
                    "5:4",
                    "4:5",
                    "21:9",
                    "1:4",
                    "4:1",
                    "1:8",
                    "8:1"
                ]
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: true,
                defaultValue: "1k",
                options: [
                    "1k",
                    "2k",
                    "4k"
                ]
            }
        ]
    },
    {
        name: "seedream-v5-lite/image-to-image",
        label: "seedream-v5-lite/image-to-image",
        capability: "image",
        params: [
            {
                fieldKey: "width",
                type: "INT",
                required: false,
                defaultValue: 2048,
                min: 1600,
                max: 4704
            },
            {
                fieldKey: "height",
                type: "INT",
                required: false,
                defaultValue: 2048,
                min: 1344,
                max: 4096
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: false,
                options: [
                    "2k",
                    "3k"
                ]
            }
        ]
    },
    {
        name: "seedream-v5-lite/text-to-image",
        label: "seedream-v5-lite/text-to-image",
        capability: "image",
        params: [
            {
                fieldKey: "width",
                type: "INT",
                required: false,
                defaultValue: 2048,
                min: 1600,
                max: 4704
            },
            {
                fieldKey: "height",
                type: "INT",
                required: false,
                defaultValue: 2048,
                min: 1344,
                max: 4096
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: false,
                options: [
                    "2k",
                    "3k"
                ]
            }
        ]
    },
    {
        name: "seedream-v5-pro/image-to-image",
        label: "seedream-v5-pro/image-to-image",
        capability: "image",
        params: [
            {
                fieldKey: "width",
                type: "INT",
                required: false,
                defaultValue: 1024,
                min: 240,
                max: 8192
            },
            {
                fieldKey: "height",
                type: "INT",
                required: false,
                defaultValue: 1024,
                min: 240,
                max: 8192
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: false,
                defaultValue: "2k",
                options: [
                    "empty",
                    "1k",
                    "2k"
                ]
            },
            {
                fieldKey: "outputFormat",
                type: "LIST",
                required: false,
                defaultValue: "jpeg",
                options: [
                    "jpeg",
                    "png"
                ]
            }
        ]
    },
    {
        name: "seedream-v5-pro/text-to-image",
        label: "seedream-v5-pro/text-to-image",
        capability: "image",
        params: [
            {
                fieldKey: "width",
                type: "INT",
                required: false,
                defaultValue: 1024,
                min: 240,
                max: 8192
            },
            {
                fieldKey: "height",
                type: "INT",
                required: false,
                defaultValue: 1024,
                min: 240,
                max: 8192
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: false,
                defaultValue: "2k",
                options: [
                    "empty",
                    "1k",
                    "2k"
                ]
            },
            {
                fieldKey: "outputFormat",
                type: "LIST",
                required: false,
                defaultValue: "jpeg",
                options: [
                    "jpeg",
                    "png"
                ]
            }
        ]
    },
    {
        name: "rhart-text-g-25-flash-cv/image-to-text",
        label: "rhart-text-g-25-flash-cv/image-to-text",
        capability: "text"
    },
    {
        name: "rhart-text-g-25-flash/image-to-text",
        label: "rhart-text-g-25-flash/image-to-text",
        capability: "text"
    },
    {
        name: "rhart-text-g-25-flash/text-to-text",
        label: "rhart-text-g-25-flash/text-to-text",
        capability: "text"
    },
    {
        name: "rhart-text-g-25-flash/video-to-text",
        label: "rhart-text-g-25-flash/video-to-text",
        capability: "text"
    },
    {
        name: "rhart-text-g-25-pro-cv/image-to-text",
        label: "rhart-text-g-25-pro-cv/image-to-text",
        capability: "text"
    },
    {
        name: "rhart-text-g-25-pro/image-to-text",
        label: "rhart-text-g-25-pro/image-to-text",
        capability: "text"
    },
    {
        name: "rhart-text-g-25-pro/text-to-text",
        label: "rhart-text-g-25-pro/text-to-text",
        capability: "text"
    },
    {
        name: "rhart-text-g-25-pro/video-to-text",
        label: "rhart-text-g-25-pro/video-to-text",
        capability: "text"
    },
    {
        name: "rhart-text-g-3-flash-preview-cv/image-to-text",
        label: "rhart-text-g-3-flash-preview-cv/image-to-text",
        capability: "text"
    },
    {
        name: "rhart-text-g-3-flash-preview/image-to-text",
        label: "rhart-text-g-3-flash-preview/image-to-text",
        capability: "text"
    },
    {
        name: "rhart-text-g-3-flash-preview/text-to-text",
        label: "rhart-text-g-3-flash-preview/text-to-text",
        capability: "text"
    },
    {
        name: "rhart-text-g-3-flash-preview/video-to-text",
        label: "rhart-text-g-3-flash-preview/video-to-text",
        capability: "text"
    },
    {
        name: "rhart-text-g-3-pro-preview-cv/image-to-text",
        label: "rhart-text-g-3-pro-preview-cv/image-to-text",
        capability: "text"
    },
    {
        name: "rhart-text-g-3-pro-preview/image-to-text",
        label: "rhart-text-g-3-pro-preview/image-to-text",
        capability: "text"
    },
    {
        name: "rhart-text-g-3-pro-preview/text-to-text",
        label: "rhart-text-g-3-pro-preview/text-to-text",
        capability: "text"
    },
    {
        name: "rhart-text-g-3-pro-preview/video-to-text",
        label: "rhart-text-g-3-pro-preview/video-to-text",
        capability: "text"
    },
    {
        name: "rhart-text-qwen-27b/chat",
        label: "rhart-text-qwen-27b/chat",
        capability: "text"
    },
    {
        name: "alibaba/wan-2.6/image-to-video",
        label: "alibaba/wan-2.6/image-to-video",
        capability: "video"
    },
    {
        name: "alibaba/wan-2.6/text-to-video",
        label: "alibaba/wan-2.6/text-to-video",
        capability: "video"
    },
    {
        name: "gemini-omni-flash/image-to-video",
        label: "gemini-omni-flash/image-to-video/channel-low-price",
        capability: "video"
    },
    {
        name: "gemini-omni-flash/text-to-video",
        label: "gemini-omni-flash/text-to-video/channel-low-price",
        capability: "video"
    },
    {
        name: "gemini-omni-flash/video-edit",
        label: "gemini-omni-flash/video-edit/channel-low-price",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-fast/image-to-video",
        label: "google/veo3.1-fast/image-to-video-channel-low-price",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-fast-official/image-to-video",
        label: "google/veo3.1-fast/image-to-video-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-fast-official/reference-to-video",
        label: "google/veo3.1-fast/reference-to-video-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-fast/start-end-to-video",
        label: "google/veo3.1-fast/start-end-to-video-channel-low-price",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-fast/text-to-video",
        label: "google/veo3.1-fast/text-to-video-channel-low-price",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-fast-official/text-to-video",
        label: "google/veo3.1-fast/text-to-video-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-fast-official/video-extend",
        label: "google/veo3.1-fast/video-extend-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-lite/image-to-video",
        label: "google/veo3.1-lite/image-to-video-channel-low-price",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-lite-official/image-to-video",
        label: "google/veo3.1-lite/image-to-video-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-lite-official/start-end-to-video",
        label: "google/veo3.1-lite/start-end-to-video-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-lite/text-to-video",
        label: "google/veo3.1-lite/text-to-video-channel-low-price",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-lite-official/text-to-video",
        label: "google/veo3.1-lite/text-to-video-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-pro/image-to-video",
        label: "google/veo3.1-pro/image-to-video-channel-low-price",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-pro-official/image-to-video",
        label: "google/veo3.1-pro/image-to-video-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-pro-official/reference-to-video",
        label: "google/veo3.1-pro/reference-to-video-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-pro/start-end-to-video",
        label: "google/veo3.1-pro/start-end-to-video-channel-low-price",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-pro/text-to-video",
        label: "google/veo3.1-pro/text-to-video-channel-low-price",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-pro-official/text-to-video",
        label: "google/veo3.1-pro/text-to-video-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-v3.1-pro-official/video-extend",
        label: "google/veo3.1-pro/video-extend-official-stable",
        capability: "video"
    },
    {
        name: "minimax/hailuo-02/fast",
        label: "hailuo-02-fast",
        capability: "video"
    },
    {
        name: "minimax/hailuo-02/i2v-pro",
        label: "hailuo-02-i2v-pro",
        capability: "video"
    },
    {
        name: "minimax/hailuo-02/i2v-standard",
        label: "hailuo-02-i2v-standard",
        capability: "video"
    },
    {
        name: "minimax/hailuo-02/pro",
        label: "hailuo-02-pro",
        capability: "video"
    },
    {
        name: "minimax/hailuo-02/standard",
        label: "hailuo-02-standard",
        capability: "video"
    },
    {
        name: "minimax/hailuo-02/t2v-pro",
        label: "hailuo-02-t2v-pro",
        capability: "video"
    },
    {
        name: "minimax/hailuo-02/t2v-standard",
        label: "hailuo-02-t2v-standard",
        capability: "video"
    },
    {
        name: "minimax/hailuo-2.3-fast-pro/image-to-video",
        label: "hailuo-2.3-fast-pro/image-to-video",
        capability: "video"
    },
    {
        name: "minimax/hailuo-2.3-fast/image-to-video",
        label: "hailuo-2.3-fast/image-to-video",
        capability: "video"
    },
    {
        name: "minimax/hailuo-2.3/t2v-pro",
        label: "hailuo-2.3-t2v-pro",
        capability: "video"
    },
    {
        name: "minimax/hailuo-2.3/t2v-standard",
        label: "hailuo-2.3-t2v-standard",
        capability: "video"
    },
    {
        name: "minimax/hailuo-2.3/image-to-video-pro",
        label: "hailuo-2.3/i2v-pro",
        capability: "video"
    },
    {
        name: "minimax/hailuo-2.3/i2v-standard",
        label: "hailuo-2.3/i2v-standard",
        capability: "video"
    },
    {
        name: "alibaba/happyhorse-1.0/image-to-video",
        label: "happyhorse-1.0/image-to-video",
        capability: "video"
    },
    {
        name: "alibaba/happyhorse-1.0/reference-to-video",
        label: "happyhorse-1.0/reference-to-video",
        capability: "video"
    },
    {
        name: "alibaba/happyhorse-1.0/text-to-video",
        label: "happyhorse-1.0/text-to-video",
        capability: "video"
    },
    {
        name: "alibaba/happyhorse-1.0/video-edit",
        label: "happyhorse-1.0/video-edit",
        capability: "video"
    },
    {
        name: "alibaba/happyhorse-1.1/image-to-video",
        label: "happyhorse-1.1/image-to-video",
        capability: "video"
    },
    {
        name: "alibaba/happyhorse-1.1/reference-to-video",
        label: "happyhorse-1.1/reference-to-video",
        capability: "video"
    },
    {
        name: "alibaba/happyhorse-1.1/text-to-video",
        label: "happyhorse-1.1/text-to-video",
        capability: "video"
    },
    {
        name: "higgsfield/dop/image-to-video",
        label: "higgsfield/dop/image-to-video",
        capability: "video"
    },
    {
        name: "kling-lip-sync/lip-sync-video",
        label: "kling-lip-sync/lip-sync-video",
        capability: "video"
    },
    {
        name: "kling-elements-advanced",
        label: "kling-o3/element",
        capability: "video"
    },
    {
        name: "kling-v2-ai-avatar-pro/image-audio-to-video",
        label: "kling-v2-ai-avatar-pro/image-audio-to-video",
        capability: "video"
    },
    {
        name: "kling-v2-ai-avatar-standard/image-audio-to-video",
        label: "kling-v2-ai-avatar-standard/image-audio-to-video",
        capability: "video"
    },
    {
        name: "kling-v2.5-turbo-pro/image-to-video",
        label: "kling-v2.5-turbo-pro/image-to-video",
        capability: "video"
    },
    {
        name: "kling-v2.5-turbo-pro/text-to-video",
        label: "kling-v2.5-turbo-pro/text-to-video",
        capability: "video"
    },
    {
        name: "kling-v2.5-turbo-std/image-to-video",
        label: "kling-v2.5-turbo-std/image-to-video",
        capability: "video"
    },
    {
        name: "kling-v2.5-turbo-std/text-to-video",
        label: "kling-v2.5-turbo-std/text-to-video",
        capability: "video"
    },
    {
        name: "kling-v2.6-pro/image-to-video",
        label: "kling-v2.6-pro-image-to-video",
        capability: "video"
    },
    {
        name: "kling-v2.6-pro/motion-control",
        label: "kling-v2.6-pro-motion-control",
        capability: "video"
    },
    {
        name: "kling-v2.6-pro/text-to-video",
        label: "kling-v2.6-pro-text-to-video",
        capability: "video"
    },
    {
        name: "kling-v2.6-std/image-to-video",
        label: "kling-v2.6-std-image-to-video",
        capability: "video"
    },
    {
        name: "kling-v2.6-std/motion-control",
        label: "kling-v2.6-std-motion-control",
        capability: "video"
    },
    {
        name: "kling-v2.6-std/text-to-video",
        label: "kling-v2.6-std-text-to-video",
        capability: "video"
    },
    {
        name: "kling-v3-4k/text-to-video",
        label: "kling-v3-4k-text-to-video",
        capability: "video"
    },
    {
        name: "kling-v3-turbo-pro/image-to-video",
        label: "kling-v3-turbo-pro-image-to-video",
        capability: "video"
    },
    {
        name: "kling-v3-turbo-pro/text-to-video",
        label: "kling-v3-turbo-pro-text-to-video",
        capability: "video"
    },
    {
        name: "kling-v3-turbo-std/image-to-video",
        label: "kling-v3-turbo-std-image-to-video",
        capability: "video"
    },
    {
        name: "kling-v3-turbo-std/text-to-video",
        label: "kling-v3-turbo-std-text-to-video",
        capability: "video"
    },
    {
        name: "kling-v3-4k/image-to-video",
        label: "kling-v3.0-4k-image-to-video",
        capability: "video"
    },
    {
        name: "kling-v3.0-4k/motion-control",
        label: "kling-v3.0-4k-motion-control",
        capability: "video"
    },
    {
        name: "kling-v3.0-pro/image-to-video",
        label: "kling-v3.0-pro-image-to-video",
        capability: "video"
    },
    {
        name: "kling-v3.0-pro/motion-control",
        label: "kling-v3.0-pro-motion-control",
        capability: "video"
    },
    {
        name: "kling-v3.0-pro/text-to-video",
        label: "kling-v3.0-pro-text-to-video",
        capability: "video"
    },
    {
        name: "kling-v3.0-std/image-to-video",
        label: "kling-v3.0-std-image-to-video",
        capability: "video"
    },
    {
        name: "kling-v3.0-std/motion-control",
        label: "kling-v3.0-std-motion-control",
        capability: "video"
    },
    {
        name: "kling-v3.0-std/text-to-video",
        label: "kling-v3.0-std-text-to-video",
        capability: "video"
    },
    {
        name: "kling-video-o1-std/edit-video",
        label: "kling-video-o1-std/edit-video",
        capability: "video"
    },
    {
        name: "kling-video-o1-std/refrence-to-video",
        label: "kling-video-o1-std/refrence-to-video",
        capability: "video"
    },
    {
        name: "kling-video-o1/image-to-video",
        label: "kling-video-o1/image-to-video",
        capability: "video"
    },
    {
        name: "kling-video-o1/start-to-end",
        label: "kling-video-o1/start-to-end",
        capability: "video"
    },
    {
        name: "kling-video-o1/text-to-video",
        label: "kling-video-o1/text-to-video",
        capability: "video"
    },
    {
        name: "kling-video-o3-4k/image-to-video",
        label: "kling-video-o3-4k-image-to-video",
        capability: "video"
    },
    {
        name: "kling-video-o3-4k/reference-to-video",
        label: "kling-video-o3-4k-reference-to-video",
        capability: "video"
    },
    {
        name: "kling-video-o3-4k/text-to-video",
        label: "kling-video-o3-4k-text-to-video",
        capability: "video"
    },
    {
        name: "kling-video-o3-pro/image-to-video",
        label: "kling-video-o3-pro-image-to-video",
        capability: "video"
    },
    {
        name: "kling-video-o3-pro/text-to-video",
        label: "kling-video-o3-pro-text-to-video",
        capability: "video"
    },
    {
        name: "kling-video-o3-pro/reference-to-video",
        label: "kling-video-o3-pro/reference-to-video",
        capability: "video"
    },
    {
        name: "kling-video-o3-pro/video-edit",
        label: "kling-video-o3-pro/video-edit",
        capability: "video"
    },
    {
        name: "kling-video-o3-std/image-to-video",
        label: "kling-video-o3-std-image-to-video",
        capability: "video"
    },
    {
        name: "kling-video-o3-std/text-to-video",
        label: "kling-video-o3-std-text-to-video",
        capability: "video"
    },
    {
        name: "kling-video-o3-std/reference-to-video",
        label: "kling-video-o3-std/reference-to-video",
        capability: "video"
    },
    {
        name: "kling-video-o3-std/video-edit",
        label: "kling-video-o3-std/video-edit",
        capability: "video"
    },
    {
        name: "rhart-video/ltx-2/text-to-video-lora",
        label: "ltx-2-19b/text-to-video-lora",
        capability: "video"
    },
    {
        name: "marble-1.0/video-to-world",
        label: "marble-1.0/video-to-world",
        capability: "video"
    },
    {
        name: "marble-1.1-plus/video-to-world",
        label: "marble-1.1-plus/video-to-world",
        capability: "video"
    },
    {
        name: "marble-1.1/video-to-world",
        label: "marble-1.1/video-to-world",
        capability: "video"
    },
    {
        name: "youchuan/image-to-video",
        label: "midjourney-image-to-video",
        capability: "video"
    },
    {
        name: "minimax/hailuo-h3/image-to-video",
        label: "MiniMax-H3 Image-to-Video (first/last frame)",
        capability: "video"
    },
    {
        name: "minimax/hailuo-h3/multimodal-to-video",
        label: "MiniMax-H3 Multimodal Reference-to-Video",
        capability: "video"
    },
    {
        name: "minimax/hailuo-h3/text-to-video",
        label: "MiniMax-H3 Text-to-Video",
        capability: "video"
    },
    {
        name: "pixverse-c1/image-to-video",
        label: "pixverse-c1/image-to-video",
        capability: "video"
    },
    {
        name: "pixverse-c1/reference-to-video",
        label: "pixverse-c1/reference-to-video",
        capability: "video"
    },
    {
        name: "pixverse-c1/text-to-video",
        label: "pixverse-c1/text-to-video",
        capability: "video"
    },
    {
        name: "pixverse-c1/transition",
        label: "pixverse-c1/transition",
        capability: "video"
    },
    {
        name: "pixverse-v5.5-effects",
        label: "pixverse-v5.5-effects",
        capability: "video"
    },
    {
        name: "pixverse-v5.5-transition",
        label: "pixverse-v5.5-transition",
        capability: "video"
    },
    {
        name: "pixverse-v5.5/image-to-video",
        label: "pixverse-v5.5/image-to-video",
        capability: "video"
    },
    {
        name: "pixverse-v5.5/text-to-video",
        label: "pixverse-v5.5/text-to-video",
        capability: "video"
    },
    {
        name: "pixverse-v5.6/image-to-video",
        label: "pixverse-v5.6/image-to-video",
        capability: "video"
    },
    {
        name: "pixverse-v5.6/text-to-video",
        label: "pixverse-v5.6/text-to-video",
        capability: "video"
    },
    {
        name: "pixverse-v6/effects",
        label: "pixverse-v6/effects",
        capability: "video"
    },
    {
        name: "pixverse-v6/image-to-video",
        label: "pixverse-v6/image-to-video",
        capability: "video"
    },
    {
        name: "pixverse-v6/text-to-video",
        label: "pixverse-v6/text-to-video",
        capability: "video"
    },
    {
        name: "pixverse-v6/transition",
        label: "pixverse-v6/transition",
        capability: "video"
    },
    {
        name: "rhart-video/video-fps-increaser",
        label: "rh-video-fps-increaser",
        capability: "video"
    },
    {
        name: "rhart-video/video-upscaler",
        label: "rh-video-upscaler",
        capability: "video"
    },
    {
        name: "rhart-video-r/gen4-aleph-official/video-to-video",
        label: "runwayml/gen4-aleph/video-to-video-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-r/gen4-turbo/image-to-video",
        label: "runwayml/gen4-turbo/image-to-video-channel-low-price",
        capability: "video"
    },
    {
        name: "rhart-video-r/gen4-turbo-official/image-to-video",
        label: "runwayml/gen4-turbo/image-to-video-official-stable",
        capability: "video"
    },
    {
        name: "bytedance/dreamactor-v2",
        label: "sd2.0/video-ref-to-video-trial",
        capability: "video"
    },
    {
        name: "bytedance/seedance-2.0-global-fast/image-to-video",
        label: "seedance-2.0-global-fast/image-to-video",
        capability: "video"
    },
    {
        name: "bytedance/seedance-2.0-global-fast/multimodal-video",
        label: "seedance-2.0-global-fast/multimodal-video",
        capability: "video"
    },
    {
        name: "bytedance/seedance-2.0-global-fast/text-to-video",
        label: "seedance-2.0-global-fast/text-to-video",
        capability: "video"
    },
    {
        name: "bytedance/seedance-2.0-global-mini/image-to-video",
        label: "seedance-2.0-global-mini/image-to-video",
        capability: "video"
    },
    {
        name: "bytedance/seedance-2.0-global-mini/multimodal-video",
        label: "seedance-2.0-global-mini/multimodal-video",
        capability: "video"
    },
    {
        name: "bytedance/seedance-2.0-global-mini/text-to-video",
        label: "seedance-2.0-global-mini/text-to-video",
        capability: "video"
    },
    {
        name: "bytedance/seedance-2.0-global/image-to-video",
        label: "seedance-2.0-global/image-to-video",
        capability: "video"
    },
    {
        name: "bytedance/seedance-2.0-global/multimodal-video",
        label: "seedance-2.0-global/multimodal-video",
        capability: "video"
    },
    {
        name: "bytedance/seedance-2.0-global/text-to-video",
        label: "seedance-2.0-global/text-to-video",
        capability: "video"
    },
    {
        name: "rhart-video/sparkvideo-2.0-mini/image-to-video",
        label: "seedance-2.0-mini/image-to-video",
        capability: "video"
    },
    {
        name: "rhart-video/sparkvideo-2.0-mini/multimodal-video",
        label: "seedance-2.0-mini/multimodal-video",
        capability: "video"
    },
    {
        name: "rhart-video/sparkvideo-2.0-mini/text-to-video",
        label: "seedance-2.0-mini/text-to-video",
        capability: "video"
    },
    {
        name: "seedance-v1-lite/reference-to-video",
        label: "seedance-v1-lite-reference-to-video",
        capability: "video"
    },
    {
        name: "seedance-v1.5-pro/image-to-video",
        label: "seedance-v1.5-pro-image-to-video",
        capability: "video"
    },
    {
        name: "seedance-v1.5-pro/image-to-video-fast",
        label: "seedance-v1.5-pro-image-to-video-fast",
        capability: "video"
    },
    {
        name: "seedance-v1.5-pro/text-to-video",
        label: "seedance-v1.5-pro-text-to-video",
        capability: "video"
    },
    {
        name: "seedance-v1.5-pro/text-to-video-fast",
        label: "seedance-v1.5-pro-text-to-video-fast",
        capability: "video"
    },
    {
        name: "rhart-video/sparkvideo-2.0-fast/image-to-video",
        label: "Seedance2.0 Fast Image to Video",
        capability: "video"
    },
    {
        name: "rhart-video/sparkvideo-2.0-fast/multimodal-video",
        label: "Seedance2.0 Fast Multimodal Video",
        capability: "video"
    },
    {
        name: "rhart-video/sparkvideo-2.0-fast/text-to-video",
        label: "Seedance2.0 Fast Text to Video",
        capability: "video"
    },
    {
        name: "rhart-video/sparkvideo-2.0/image-to-video",
        label: "Seedance2.0 Image to Video",
        capability: "video"
    },
    {
        name: "rhart-video/sparkvideo-2.0/multimodal-video",
        label: "Seedance2.0 Multimodal Video",
        capability: "video"
    },
    {
        name: "rhart-video/sparkvideo-2.0/text-to-video",
        label: "Seedance2.0 Text to Video",
        capability: "video"
    },
    {
        name: "skyreels-v3/reference-to-video",
        label: "skyreels-v3/reference-to-video",
        capability: "video"
    },
    {
        name: "skyreels-v3/shot-switching-video-extension",
        label: "skyreels-v3/shot-switching-video-extension",
        capability: "video"
    },
    {
        name: "skyreels-v3/single-shot-video-extension",
        label: "skyreels-v3/single-shot-video-extension",
        capability: "video"
    },
    {
        name: "skyreels-v3/video-restyling",
        label: "skyreels-v3/video-restyling",
        capability: "video"
    },
    {
        name: "skyreels-v4/image-to-video-fast",
        label: "skyreels-v4/image-to-video-fast",
        capability: "video"
    },
    {
        name: "skyreels-v4/image-to-video-std",
        label: "skyreels-v4/image-to-video-std",
        capability: "video"
    },
    {
        name: "skyreels-v4/omni-reference-fast",
        label: "skyreels-v4/omni-reference-fast",
        capability: "video"
    },
    {
        name: "skyreels-v4/omni-reference-std",
        label: "skyreels-v4/omni-reference-std",
        capability: "video"
    },
    {
        name: "skyreels-v4/text-to-video-fast",
        label: "skyreels-v4/text-to-video-fast",
        capability: "video"
    },
    {
        name: "skyreels-v4/text-to-video-std",
        label: "skyreels-v4/text-to-video-std",
        capability: "video"
    },
    {
        name: "rhart-video-s/image-to-video-asyn",
        label: "sora-2/image-to-video-asyn-channel-low-price",
        capability: "video"
    },
    {
        name: "rhart-video-s/image-to-video",
        label: "sora-2/image-to-video-channel-low-price",
        capability: "video"
    },
    {
        name: "rhart-video-s-official/image-to-video",
        label: "sora-2/image-to-video-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-s/image-to-video-pro-deprecated",
        label: "sora-2/image-to-video-pro-channel-low-price",
        capability: "video"
    },
    {
        name: "rhart-video-s-official/image-to-video-pro",
        label: "sora-2/image-to-video-pro-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-s-official/image-to-video-realistic",
        label: "sora-2/image-to-video-realistic-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-s/text-to-video",
        label: "sora-2/text-to-video-channel-low-price",
        capability: "video"
    },
    {
        name: "rhart-video-s-official/text-to-video",
        label: "sora-2/text-to-video-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-s/text-to-video-pro-deprecated",
        label: "sora-2/text-to-video-pro-channel-low-price",
        capability: "video"
    },
    {
        name: "rhart-video-s-official/text-to-video-pro",
        label: "sora-2/text-to-video-pro-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-s-official/sora-upload-character",
        label: "sora-upload-character-official",
        capability: "video"
    },
    {
        name: "rhart-video/sparkvideo-2.0/multimodal-video-star-fast",
        label: "Stephen Chow IP Video Gen-Fast (Seedance 2.0 Fast)",
        capability: "video"
    },
    {
        name: "rhart-video/sparkvideo-2.0/multimodal-video-star",
        label: "Stephen Chow IP Video Gen(Seedance 2.0)",
        capability: "video"
    },
    {
        name: "topazlabs/video-astra",
        label: "topazlabs-video-astra",
        capability: "video"
    },
    {
        name: "topazlabs/video-denoise",
        label: "topazlabs-video-denoise",
        capability: "video"
    },
    {
        name: "topazlabs/video-frame-interpolation",
        label: "topazlabs-video-frame-interpolation",
        capability: "video"
    },
    {
        name: "topazlabs/video-proteus",
        label: "topazlabs-video-proteus",
        capability: "video"
    },
    {
        name: "topazlabs/video-starlight",
        label: "topazlabs-video-starlight",
        capability: "video"
    },
    {
        name: "topazlabs/video-upscale",
        label: "topazlabs-video-upscale",
        capability: "video"
    },
    {
        name: "vidu/image-to-video-q2-pro",
        label: "Vidu-image-to-video-q2-pro",
        capability: "video"
    },
    {
        name: "vidu/image-to-video-q2-pro-fast",
        label: "Vidu-image-to-video-q2-pro-fast",
        capability: "video"
    },
    {
        name: "vidu/image-to-video-q2-turbo",
        label: "Vidu-image-to-video-q2-turbo",
        capability: "video"
    },
    {
        name: "vidu/image-to-video-q3-pro",
        label: "Vidu-image-to-video-q3-pro",
        capability: "video"
    },
    {
        name: "vidu/image-to-video-q3-pro-fast",
        label: "Vidu-image-to-video-q3-pro-fast",
        capability: "video"
    },
    {
        name: "vidu/image-to-video-q3-turbo",
        label: "Vidu-image-to-video-q3-turbo",
        capability: "video"
    },
    {
        name: "vidu/reference-to-video-q2",
        label: "Vidu-reference-to-video-q2",
        capability: "video"
    },
    {
        name: "vidu/reference-to-video-q2-pro",
        label: "Vidu-reference-to-video-q2-pro",
        capability: "video"
    },
    {
        name: "vidu/reference-to-video-q3",
        label: "Vidu-reference-to-video-q3",
        capability: "video"
    },
    {
        name: "vidu/reference-to-video-q3-ad",
        label: "Vidu-reference-to-video-q3-ad",
        capability: "video"
    },
    {
        name: "vidu/reference-to-video-q3-drama",
        label: "Vidu-reference-to-video-q3-drama",
        capability: "video"
    },
    {
        name: "vidu/reference-to-video-q3-mix",
        label: "Vidu-reference-to-video-q3-mix",
        capability: "video"
    },
    {
        name: "vidu/start-end-to-video-q2-pro",
        label: "Vidu-start-end-to-video-q2-pro",
        capability: "video"
    },
    {
        name: "vidu/start-end-to-video-q2-pro-fast",
        label: "Vidu-start-end-to-video-q2-pro-fast",
        capability: "video"
    },
    {
        name: "vidu/start-end-to-video-q2-turbo",
        label: "Vidu-start-end-to-video-q2-turbo",
        capability: "video"
    },
    {
        name: "vidu/start-end-to-video-q3-pro",
        label: "Vidu-start-end-to-video-q3-pro",
        capability: "video"
    },
    {
        name: "vidu/start-end-to-video-q3-pro-fast",
        label: "Vidu-start-end-to-video-q3-pro-fast",
        capability: "video"
    },
    {
        name: "vidu/start-end-to-video-q3-turbo",
        label: "Vidu-start-end-to-video-q3-turbo",
        capability: "video"
    },
    {
        name: "vidu/text-to-video",
        label: "Vidu-text-to-video-q2",
        capability: "video"
    },
    {
        name: "vidu/text-to-video-q3-pro",
        label: "Vidu-text-to-video-q3-pro",
        capability: "video"
    },
    {
        name: "vidu/text-to-video-q3-pro-fast",
        label: "Vidu-text-to-video-q3-pro-fast",
        capability: "video"
    },
    {
        name: "vidu/text-to-video-q3-turbo",
        label: "Vidu-text-to-video-q3-turbo",
        capability: "video"
    },
    {
        name: "volc-drama/serial-video-translate",
        label: "volc-drama/serial-video-translate",
        capability: "video"
    },
    {
        name: "volc-drama/video-translate",
        label: "volc-drama/video-translate",
        capability: "video"
    },
    {
        name: "volc-subtitle-erase-pro/video",
        label: "volc-subtitle-erase/video(Refined version)",
        capability: "video"
    },
    {
        name: "volc-subtitle-erase/video",
        label: "volc-subtitle-erase/video(Standard Version)",
        capability: "video"
    },
    {
        name: "alibaba/wan-2.5-preview/image-to-video",
        label: "wan-2.5-preview/image-to-video",
        capability: "video"
    },
    {
        name: "alibaba/wan-2.5-preview/text-to-video",
        label: "wan-2.5-preview/text-to-video",
        capability: "video"
    },
    {
        name: "alibaba/wan-2.6/image-to-video-flash",
        label: "wan-2.6-image-to-video-flash",
        capability: "video"
    },
    {
        name: "alibaba/wan-2.6/reference-to-video",
        label: "wan-2.6-reference-to-video",
        capability: "video"
    },
    {
        name: "alibaba/wan-2.6/reference-to-video-flash",
        label: "wan-2.6-reference-to-video-flash",
        capability: "video"
    },
    {
        name: "alibaba/wan-2.7/reference-to-video",
        label: "wan-2.7-reference-to-video",
        capability: "video"
    },
    {
        name: "alibaba/wan-2.7-spicy/image-to-video",
        label: "wan-2.7-spicy/image-to-video",
        capability: "video"
    },
    {
        name: "alibaba/wan-2.7/image-to-video",
        label: "wan-2.7/image-to-video",
        capability: "video"
    },
    {
        name: "alibaba/wan-2.7/text-to-video",
        label: "wan-2.7/text-to-video",
        capability: "video"
    },
    {
        name: "alibaba/wan-2.7/video-edit",
        label: "wan-2.7/video-edit",
        capability: "video"
    },
    {
        name: "alibaba/wan-2.7/video-extend",
        label: "wan-2.7/video-extend",
        capability: "video"
    },
    {
        name: "rhart-video-g-official/image-to-video-v1.5",
        label: "xai/grok-imagine-video-v1.5/image-to-video-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-g-official/reference-to-video",
        label: "xai/grok-imagine-video/reference-to-video-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-g-official/video-extend",
        label: "xai/grok-imagine-video/video-extend-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-g-official/edit-video",
        label: "xai/grok-imagine/edit-video-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-g/image-to-video",
        label: "xai/grok-imagine/image-to-video-channel-low-price-v1.5",
        capability: "video"
    },
    {
        name: "rhart-video-g-official/image-to-video",
        label: "xai/grok-imagine/image-to-video-official-stable",
        capability: "video"
    },
    {
        name: "rhart-video-g/text-to-video",
        label: "xai/grok-imagine/text-to-video-channel-low-price-v1.5",
        capability: "video"
    },
    {
        name: "rhart-video-g-official/text-to-video",
        label: "xai/grok-imagine/text-to-video-official-stable",
        capability: "video"
    },
    {
        name: "hitem3d-v15/image-to-3d",
        label: "hitem3d-v1.5/image-to-3d",
        capability: "model",
        params: [
            {
                fieldKey: "requestType",
                type: "LIST",
                required: true,
                defaultValue: "both",
                options: [
                    "mesh",
                    "both"
                ]
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: true,
                defaultValue: "1024",
                options: [
                    "512",
                    "1024",
                    "1536",
                    "1536pro"
                ]
            },
            {
                fieldKey: "face",
                type: "INT",
                required: false,
                defaultValue: 1000000,
                min: 100000,
                max: 2000000
            }
        ]
    },
    {
        name: "hitem3d-v2/image-to-3d",
        label: "hitem3d-v2/image-to-3d",
        capability: "model",
        params: [
            {
                fieldKey: "requestType",
                type: "LIST",
                required: true,
                defaultValue: "both",
                options: [
                    "mesh",
                    "both"
                ]
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: true,
                defaultValue: "1536",
                options: [
                    "512",
                    "1024",
                    "1536",
                    "1536pro"
                ]
            },
            {
                fieldKey: "face",
                type: "INT",
                required: false,
                defaultValue: 2000000,
                min: 100000,
                max: 2000000
            }
        ]
    },
    {
        name: "hitem3d-v15/multi-image-to-3d",
        label: "hitem3d-v1.5/multi-image-to-3d",
        capability: "model",
        params: [
            {
                fieldKey: "requestType",
                type: "LIST",
                required: true,
                defaultValue: "both",
                options: [
                    "mesh",
                    "both"
                ]
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: true,
                defaultValue: "1024",
                options: [
                    "512",
                    "1024",
                    "1536",
                    "1536pro"
                ]
            },
            {
                fieldKey: "face",
                type: "INT",
                required: false,
                defaultValue: 1000000,
                min: 100000,
                max: 2000000
            }
        ]
    },
    {
        name: "hitem3d-v2/multi-image-to-3d",
        label: "hitem3d-v2/multi-image-to-3d",
        capability: "model",
        params: [
            {
                fieldKey: "requestType",
                type: "LIST",
                required: true,
                defaultValue: "both",
                options: [
                    "mesh",
                    "both"
                ]
            },
            {
                fieldKey: "resolution",
                type: "LIST",
                required: true,
                defaultValue: "1536",
                options: [
                    "512",
                    "1024",
                    "1536",
                    "1536pro"
                ]
            },
            {
                fieldKey: "face",
                type: "INT",
                required: false,
                defaultValue: 2000000,
                min: 100000,
                max: 2000000
            }
        ]
    },
    {
        name: "hunyuan3d-v3.1/image-to-3d",
        label: "hunyuan3d-v3.1/image-to-3d",
        capability: "model",
        params: [
            {
                fieldKey: "generateType",
                type: "LIST",
                required: true,
                defaultValue: "Normal",
                options: [
                    "Normal",
                    "Geometry",
                    "Sketch"
                ]
            },
            {
                fieldKey: "enablePbr",
                type: "BOOLEAN",
                required: true,
                defaultValue: false
            },
            {
                fieldKey: "faceCount",
                type: "INT",
                required: false,
                defaultValue: 500000,
                min: 10000,
                max: 1500000
            }
        ]
    },
    {
        name: "hunyuan3d-v3.1/text-to-3d",
        label: "hunyuan3d-v3.1/text-to-3d",
        capability: "model",
        params: [
            {
                fieldKey: "generateType",
                type: "LIST",
                required: true,
                defaultValue: "Normal",
                options: [
                    "Normal",
                    "Geometry",
                    "Sketch"
                ]
            },
            {
                fieldKey: "enablePbr",
                type: "BOOLEAN",
                required: true,
                defaultValue: false
            },
            {
                fieldKey: "faceCount",
                type: "INT",
                required: false,
                defaultValue: 500000,
                min: 10000,
                max: 1500000
            }
        ]
    }
];
