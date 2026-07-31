//
//  AloudTtsModule.m
//
//  The ObjC bridge that exposes the Swift `AloudTts` class to React Native.
//  These are the "bridging macros RN relies on": RCT_EXTERN_MODULE registers
//  the module, and each RCT_EXTERN_METHOD must match the Swift `@objc` selector
//  *exactly* — a mismatch here is the classic runtime crash (unrecognized
//  selector), not a compile error. Keeping this file and AloudTtsModule.swift in
//  lockstep is precisely the cross-language-signature discipline this project is
//  built to demonstrate.
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(AloudTts, RCTEventEmitter)

RCT_EXTERN_METHOD(getCoreVersion:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(load:(NSString *)text
                  traceId:(NSString *)traceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(play:(NSString *)traceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(pause:(NSString *)traceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(next:(NSString *)traceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(prev:(NSString *)traceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(seekUnit:(nonnull NSNumber *)unit
                  traceId:(NSString *)traceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(seekByte:(nonnull NSNumber *)byte
                  traceId:(NSString *)traceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(release:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
