import Map "mo:core/Map";
import Array "mo:core/Array";
import Time "mo:core/Time";
import List "mo:core/List";
import Iter "mo:core/Iter";
import Principal "mo:core/Principal";
import Order "mo:core/Order";
import Runtime "mo:core/Runtime";
import MixinAuthorization "authorization/MixinAuthorization";
import AccessControl "authorization/access-control";

actor {
  type CameraSettings = {
    zoom : Nat;
    focus : Nat;
    whiteBalance : { #auto; #custom : Nat };
    iso : Nat;
    shutterSpeed : Nat;
    brightness : Int;
    exposure : Int;
    contrast : Int;
    saturation : Int;
    sharpness : Int;
    colorTemperature : Nat;
    torchOn : Bool;
    imageQuality : Nat;
    aspectRatio : { #ratio16_9; #ratio4_3; #ratio1_1 };
    flip : Bool;
    mirror : Bool;
    gridOverlay : Bool;
    cameraDeviceId : Text;
    resolution : Nat;
  };

  type Preset = {
    name : Text;
    settings : CameraSettings;
  };

  module Preset {
    public func compareByName(a : Preset, b : Preset) : Order.Order {
      Text.compare(a.name, b.name);
    };
  };

  type Feedback = {
    rating : Nat;
    review : ?Text;
    timestamp : Time.Time;
    user : Principal;
  };

  module Feedback {
    public func compare(a : Feedback, b : Feedback) : Order.Order {
      Int.compare(b.timestamp, a.timestamp);
    };
  };

  public type UserProfile = {
    name : Text;
  };

  let userSettings = Map.empty<Principal, CameraSettings>();
  let userPresets = Map.empty<Principal, Map.Map<Text, Preset>>();
  let feedbackEntries = Map.empty<Principal, Feedback>();
  let userProfiles = Map.empty<Principal, UserProfile>();
  let accessControlState = AccessControl.initState();
  include MixinAuthorization(accessControlState);

  func defaultSettings() : CameraSettings {
    {
      zoom = 1;
      focus = 50;
      whiteBalance = #auto;
      iso = 100;
      shutterSpeed = 100;
      brightness = 0;
      exposure = 0;
      contrast = 0;
      saturation = 0;
      sharpness = 50;
      colorTemperature = 6500;
      torchOn = false;
      imageQuality = 80;
      aspectRatio = #ratio16_9;
      flip = false;
      mirror = false;
      gridOverlay = false;
      cameraDeviceId = "";
      resolution = 1080;
    };
  };

  // User profile functions
  public query ({ caller }) func getCallerUserProfile() : async ?UserProfile {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can get profiles");
    };
    userProfiles.get(caller);
  };

  public query ({ caller }) func getUserProfile(user : Principal) : async ?UserProfile {
    if (caller != user and not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: Can only view your own profile");
    };
    userProfiles.get(user);
  };

  public shared ({ caller }) func saveCallerUserProfile(profile : UserProfile) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can save profiles");
    };
    userProfiles.add(caller, profile);
  };

  // User settings functions
  public shared ({ caller }) func saveUserSettings(settings : CameraSettings) : async () {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: Only users can save settings");
    };
    userSettings.add(caller, settings);
  };

  public query ({ caller }) func getUserSettings() : async CameraSettings {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: Only users can get settings");
    };
    switch (userSettings.get(caller)) {
      case (null) { defaultSettings() };
      case (?settings) { settings };
    };
  };

  public shared ({ caller }) func resetUserSettings() : async () {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: Only users can reset settings");
    };
    userSettings.add(caller, defaultSettings());
  };

  // Preset functions
  public shared ({ caller }) func savePreset(name : Text, settings : CameraSettings) : async () {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: Only users can save presets");
    };
    let userMap = switch (userPresets.get(caller)) {
      case (null) {
        let emptyMap = Map.empty<Text, Preset>();
        emptyMap;
      };
      case (?map) { map };
    };
    userMap.add(name, { name; settings });
    userPresets.add(caller, userMap);
  };

  public query ({ caller }) func getPresets() : async [Preset] {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: Only users can get presets");
    };
    switch (userPresets.get(caller)) {
      case (null) { [] };
      case (?presets) { presets.values().toArray().sort(Preset.compareByName) };
    };
  };

  public query ({ caller }) func getPreset(name : Text) : async Preset {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: Only users can get a preset");
    };
    switch (userPresets.get(caller)) {
      case (null) { Runtime.trap("Preset not found") };
      case (?presets) {
        switch (presets.get(name)) {
          case (null) { Runtime.trap("Preset not found") };
          case (?preset) { preset };
        };
      };
    };
  };

  public shared ({ caller }) func deletePreset(name : Text) : async () {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: Only users can delete presets");
    };
    switch (userPresets.get(caller)) {
      case (null) { () };
      case (?presets) {
        presets.remove(name);
        if (presets.isEmpty()) {
          userPresets.remove(caller);
        };
      };
    };
  };

  // Feedback functions
  public query ({ caller }) func getAllFeedback() : async [Feedback] {
    feedbackEntries.values().toArray().sort();
  };

  public query ({ caller }) func getAverageRating() : async Float {
    let feedbackArray = feedbackEntries.values().toArray();
    if (feedbackArray.isEmpty()) { return 0.0 };
    var sum = 0.0;
    for (entry in feedbackArray.values()) {
      sum += entry.rating.toFloat();
    };
    sum / feedbackArray.size().toFloat();
  };

  public shared ({ caller }) func submitFeedback(rating : Nat, review : ?Text) : async () {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: Only users can submit feedback");
    };
    if (rating < 1 or rating > 5) {
      Runtime.trap("Rating must be between 1 and 5");
    };
    feedbackEntries.add(
      caller,
      {
        rating;
        review;
        timestamp = Time.now();
        user = caller;
      },
    );
  };
};
