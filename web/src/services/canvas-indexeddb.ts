import localforage from "localforage";

export const canvasDatabase = localforage.createInstance({ name: "infinite-canvas", storeName: "app_state", driver: localforage.INDEXEDDB });

/** 复用 localforage 的库与记录格式；读、比较、写必须处于同一原生事务。 */
export async function updateCanvasRecord<T>(key: string, update: (current: T | null) => T): Promise<T> {
    await canvasDatabase.ready();
    return new Promise<T>((resolve, reject) => {
        const request = indexedDB.open(canvasDatabase.config("name"));
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const connection = request.result;
            let transaction: IDBTransaction;
            try {
                transaction = connection.transaction(canvasDatabase.config("storeName"), "readwrite");
            } catch (error) {
                connection.close();
                reject(error);
                return;
            }
            let result: T;
            let failure: unknown;
            transaction.oncomplete = () => { connection.close(); resolve(result); };
            transaction.onabort = () => { connection.close(); reject(failure ?? transaction.error ?? new Error("画布保存事务已取消，请重试。")); };
            const store = transaction.objectStore(canvasDatabase.config("storeName"));
            const read = store.get(key);
            read.onsuccess = () => {
                try {
                    const current = read.result ?? null;
                    result = update(current);
                    if (result !== current) store.put(result, key);
                } catch (error) {
                    failure = error;
                    transaction.abort();
                }
            };
        };
    });
}
