#!/bin/bash

# Default values of arguments
DEPLOY_PROD=0
DEPLOY_STAGE=0
DEPLOY_ALL=0

# Loop through arguments and process them
for arg in "$@"
do
    case $arg in
        -p|--production)
        DEPLOY_PROD=1
        shift
        ;;
    esac
    case $arg in
        -s|--stage)
        DEPLOY_STAGE=1
        shift
        ;;
    esac
    case $arg in
        -a|--all)
        DEPLOY_ALL=1
        shift
        ;;
    esac
done

# Clean Phase
rm -rf build
mkdir build

# Copy Phase
cp index.html build
cp manifest.json build
cp style.css build
cp -r Lib build
cp -r GameSDK build
cp -r SVG build
cp -r favicon build

cd build

if [ $DEPLOY_STAGE -eq 1 ] || [ $DEPLOY_ALL -eq 1 ]
then
   echo "Push to Stage"
   aws s3 sync . s3://kwigbelle-stage --delete
fi

if [ $DEPLOY_PROD -eq 1 ] || [ $DEPLOY_ALL -eq 1 ]
then
   echo "Push to Production"
   aws s3 sync s3://kwigbelle-stage s3://kwigbelle --delete
   aws cloudfront create-invalidation --distribution-id EMDM091I7VR9X --paths "/*"
fi
