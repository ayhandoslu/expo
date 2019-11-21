// Copyright 2016-present 650 Industries. All rights reserved.

#import <Foundation/Foundation.h>

typedef NS_OPTIONS(unsigned int, ABI36_0_0UMFileSystemPermissionFlags) {
  ABI36_0_0UMFileSystemPermissionNone = 0,
  ABI36_0_0UMFileSystemPermissionRead = 1 << 1,
  ABI36_0_0UMFileSystemPermissionWrite = 1 << 2,
};

// TODO: Maybe get rid of this interface in favor of ABI36_0_0EXFileSystemManager and private utilities classes
@protocol ABI36_0_0UMFileSystemInterface

@property (nonatomic, readonly) NSString *documentDirectory;
@property (nonatomic, readonly) NSString *cachesDirectory;
@property (nonatomic, readonly) NSString *bundleDirectory;

// TODO: Move permissionsForURI to ABI36_0_0UMFileSystemManagerInterface
- (ABI36_0_0UMFileSystemPermissionFlags)permissionsForURI:(NSURL *)uri;
- (NSString *)generatePathInDirectory:(NSString *)directory withExtension:(NSString *)extension;
- (BOOL)ensureDirExistsWithPath:(NSString *)path;

@end