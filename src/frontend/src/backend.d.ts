import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface CameraSettings {
    iso: bigint;
    focus: bigint;
    exposure: bigint;
    sharpness: bigint;
    torchOn: boolean;
    imageQuality: bigint;
    contrast: bigint;
    flip: boolean;
    zoom: bigint;
    mirror: boolean;
    shutterSpeed: bigint;
    brightness: bigint;
    colorTemperature: bigint;
    resolution: bigint;
    cameraDeviceId: string;
    gridOverlay: boolean;
    whiteBalance: {
        __kind__: "custom";
        custom: bigint;
    } | {
        __kind__: "auto";
        auto: null;
    };
    saturation: bigint;
    aspectRatio: Variant_ratio1_1_ratio4_3_ratio16_9;
}
export type Time = bigint;
export interface Preset {
    name: string;
    settings: CameraSettings;
}
export interface UserProfile {
    name: string;
}
export interface Feedback {
    review?: string;
    user: Principal;
    timestamp: Time;
    rating: bigint;
}
export enum UserRole {
    admin = "admin",
    user = "user",
    guest = "guest"
}
export enum Variant_ratio1_1_ratio4_3_ratio16_9 {
    ratio1_1 = "ratio1_1",
    ratio4_3 = "ratio4_3",
    ratio16_9 = "ratio16_9"
}
export interface backendInterface {
    assignCallerUserRole(user: Principal, role: UserRole): Promise<void>;
    deletePreset(name: string): Promise<void>;
    getAllFeedback(): Promise<Array<Feedback>>;
    getAverageRating(): Promise<number>;
    getCallerUserProfile(): Promise<UserProfile | null>;
    getCallerUserRole(): Promise<UserRole>;
    getPreset(name: string): Promise<Preset>;
    getPresets(): Promise<Array<Preset>>;
    getUserProfile(user: Principal): Promise<UserProfile | null>;
    getUserSettings(): Promise<CameraSettings>;
    isCallerAdmin(): Promise<boolean>;
    resetUserSettings(): Promise<void>;
    saveCallerUserProfile(profile: UserProfile): Promise<void>;
    savePreset(name: string, settings: CameraSettings): Promise<void>;
    saveUserSettings(settings: CameraSettings): Promise<void>;
    submitFeedback(rating: bigint, review: string | null): Promise<void>;
}
