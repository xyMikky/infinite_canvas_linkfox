export type ReferenceImage = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    url?: string;
    storageKey?: string;
    /** 该参考位按文件夹批量时的图片，已按文件名排序。没有则这一位是固定单张。 */
    batchImages?: ReferenceImage[];
};
